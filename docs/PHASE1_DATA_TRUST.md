# Phase 1 Data Trust

## Protected boundaries

Phase 1 surrounds the stable Acute importer and live dashboard queries with read-only evidence. It does not change workbook parsing, header mapping, normalization, conflict targets, chunking, transactions, write order, database keys, schema, migrations, or production data.

The following remain frozen:

- `lib/import-core.mjs`
- `app/api/admin/import/route.ts`
- `app/(dashboard)/admin/import/page.tsx`
- `scripts/import.ts`
- `scripts/pg-import.mjs`
- `supabase/schema.sql` and all migrations

## Data Trust reads

`lib/data-trust.ts` executes only fixed aggregate `SELECT` statements. It reports counts, ranges, monthly coverage, missing fields, date/month mismatches, doctor-name variation counts, and fact-to-visit relationship integrity. It does not return patient-level rows.

Acute import history remains browser-local under `hp-upload-history`. The Data Trust page displays it only as non-authoritative local context; it does not claim durable database provenance.

## Snapshot safety

The bundled snapshot contains unfiltered monthly aggregates for `2026-01` through `2026-06`. A cached KPI result is permitted only when the request selects one of those months and has no specialty, doctor, drug, disease, risk-carrier, search, or compare-day filter.

Uncovered months, filtered requests, open-ended reporting windows, entity KPI requests, performance matrices, and complete search catalogs are unavailable when live reads fail. They do not receive broader snapshot aggregates.

Live SQL, bind parameters, filters, formulas, joins, aggregations, and result shapes are unchanged.

## Source labels

- `LIVE`: all recorded results are live.
- `CACHED`: recorded results use an exact supported cache.
- `MIXED`: the page includes both live and cached results and is explicitly degraded.
- `UNAVAILABLE`: at least one required view cannot be answered exactly.

Freshness is factual only: read time, data date range, latest reporting month, snapshot generation time, age, and coverage. No freshness threshold is applied.
