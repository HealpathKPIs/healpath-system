import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { readFileSync } from 'fs';
import path from 'path';
import pg from 'pg';
const cs = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]+/, '');
const ca = readFileSync(path.join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
const pool = new pg.Pool({ connectionString: cs, ssl: { ca, rejectUnauthorized: true }, max: 3 });

const sizes = await pool.query(`
  select relname as table,
         to_char(n_live_tup, 'FM999,999,999') as rows,
         pg_size_pretty(pg_total_relation_size(relid)) as size
  from pg_stat_user_tables where schemaname='healpath' order by n_live_tup desc`);
console.log('TABLES');
for (const r of sizes.rows) console.log(`  ${r.table.padEnd(26)} ${String(r.rows).padStart(12)} rows  ${r.size}`);

const idx = await pool.query(`
  select tablename, indexname, indexdef from pg_indexes
  where schemaname='healpath' order by tablename, indexname`);
console.log('\nINDEXES');
let last='';
for (const r of idx.rows) {
  if (r.tablename !== last) { console.log(`  ${r.tablename}:`); last = r.tablename; }
  console.log(`      ${r.indexname}  ${r.indexdef.replace(/^.*USING /,'')}`);
}

// jsonb payload size — the chronic tables store whole rows as row_data
const jb = await pool.query(`
  select 'chronic_pre' as t, count(*)::int n,
         pg_size_pretty(sum(pg_column_size(row_data))::bigint) as jsonb_bytes,
         max(jsonb_array_length(coalesce(jsonb_path_query_array(row_data,'$.keyvalue()'),'[]'::jsonb)))::int as max_keys
  from healpath.chronic_pre
  union all
  select 'chronic_post', count(*)::int,
         pg_size_pretty(sum(pg_column_size(row_data))::bigint),
         max(jsonb_array_length(coalesce(jsonb_path_query_array(row_data,'$.keyvalue()'),'[]'::jsonb)))::int
  from healpath.chronic_post`);
console.log('\nCHRONIC JSONB PAYLOAD');
for (const r of jb.rows) console.log(`  ${r.t.padEnd(14)} ${r.n} rows, ${r.jsonb_bytes} jsonb, up to ${r.max_keys} keys/row`);
await pool.end();
