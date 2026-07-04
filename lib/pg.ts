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
  return new Pool({
    connectionString: conn.toString(),
    ssl: ca ? { ca } : undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// Reuse a single pool across hot reloads and requests.
const g = globalThis as unknown as { __hpPool?: Pool | null };
const pool = g.__hpPool ?? (g.__hpPool = makePool());

export const hasDb = Boolean(pool);

export async function dbQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) throw new Error('DATABASE_URL not configured');
  const res = await pool.query(text, params);
  return res.rows as T[];
}
