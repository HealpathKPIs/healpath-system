// Server-side direct Postgres access to the Supabase database.
//
// Used by the query layer to run the Power BI metric SQL as PARAMETERISED,
// read-only queries against the Supabase Session Pooler over verified TLS
// (Supabase CA in certs/prod-ca-2021.crt; certificate verification stays on).
//
// This deliberately avoids an arbitrary-SQL RPC — every query is a fixed
// statement with positional bind parameters, so user input (month/specialty
// from the URL) can never be interpolated into SQL.
//
// Must never be imported from a client component (no 'use client' consumers).

import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { recordLiveQuery, recordQueryFailure } from './data-source';

const url = process.env.DATABASE_URL;

function makePool(): Pool | null {
  if (!url) return null;
  const conn = new URL(url);
  conn.searchParams.delete('sslmode'); // explicit verified ssl:{ca} is authoritative
  let ca: string | undefined;
  try {
    ca = readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  } catch {
    ca = undefined;
  }
  // On Vercel every concurrent request is its own instance with its own pool, so
  // a long idle retention makes each one hoard pooler connections it is not
  // using; released quickly, they go back to the shared budget. A long-lived
  // local server benefits from the opposite.
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  return new Pool({
    connectionString: conn.toString(),
    ssl: ca ? { ca } : undefined,
    max: 4,
    idleTimeoutMillis: serverless ? 5_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// Reuse a single pool across hot reloads and requests.
const g = globalThis as unknown as { __hpPool?: Pool | null };
const pool = g.__hpPool ?? (g.__hpPool = makePool());

export const hasDb = Boolean(pool);

/** First meaningful line of a statement, for logs (never the bind parameters). */
function queryContext(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
}

/**
 * Connection-level failures worth one retry: the connection was lost, refused,
 * timed out, or the pooler was momentarily out of slots. A SQL error (bad syntax,
 * missing column, constraint violation) is deterministic and never retried.
 */
function isTransientConnectionError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  const code = err?.code ?? '';
  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'ECONNREFUSED', '57P01', '53300', '08006', '08003'].includes(code)) {
    return true;
  }
  const message = (err?.message ?? '').toLowerCase();
  return (
    message.includes('connection terminated') ||
    message.includes('connection ended') ||
    message.includes('too many clients') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('server closed the connection')
  );
}

export async function dbQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) throw new Error('DATABASE_URL not configured');
  // Every live query reports its outcome here — the one place all the
  // snapshot-fallback sites in the query layer funnel through. The error is
  // logged with its context and then rethrown, so the existing fallbacks still
  // work but can no longer happen silently.
  //
  // One retry first: a page fires dozens of queries at once and a single
  // momentarily-unavailable connection would otherwise turn that page into
  // "cached snapshot". Only connection-level failures are retried.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await pool.query(text, params);
      recordLiveQuery();
      return res.rows as T[];
    } catch (error) {
      if (attempt === 0 && isTransientConnectionError(error)) {
        console.warn(
          '[data-source] transient query failure, retrying once',
          JSON.stringify({ context: queryContext(text), reason: (error as Error).message }),
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      recordQueryFailure(queryContext(text), error);
      throw error;
    }
  }
}

/**
 * Is the database reachable right now? Used by /api/health so the dashboard can
 * tell live from cached without waiting for a page's queries to fail.
 */
export async function dbHealthCheck(timeoutMs = 4000): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  if (!pool) return { reachable: false, latencyMs: 0, error: 'DATABASE_URL not configured' };
  try {
    await Promise.race([
      pool.query('select 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`health check timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { reachable: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { reachable: false, latencyMs: Date.now() - started, error: (error as Error).message };
  }
}
