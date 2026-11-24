import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL;

function makePool(): Pool | null {
  if (!url) return null;
  const connection = new URL(url);
  connection.searchParams.delete('sslmode');
  let ca: string | undefined;
  try { ca = readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8'); } catch { ca = undefined; }
  return new Pool({ connectionString: connection.toString(), ssl: ca ? { ca } : undefined, max: 2, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
}

const globalState = globalThis as unknown as { __hpGovernancePool?: Pool | null };
const pool = globalState.__hpGovernancePool ?? (globalState.__hpGovernancePool = makePool());

export async function governanceQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) throw new Error('DATABASE_URL not configured');
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function withGovernanceTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('DATABASE_URL not configured');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
