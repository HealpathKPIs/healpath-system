# HealPath Executive BI Dashboard

Internal executive dashboard that reproduces the `healpath_dashboard.pbix` Power BI
model as an always-on web app: Next.js (App Router, TypeScript) on Vercel, a
Supabase Postgres backend, and Recharts for the charts.

The app runs immediately against a bundled 2026 snapshot (`data/snapshot2026.json`),
so every page and filter works before Supabase is wired up. Once the database is
configured the same queries run live against Postgres.

## Pages

| Route | Page | Shows |
|---|---|---|
| `/` | Overview | 5 KPI cards, top-5 disease blocks, top-5 active ingredients, avg-per-visit trend |
| `/diseases` | Disease & Diagnosis | ICD-block ranking, block share, searchable drill table |
| `/pharmacy` | Pharmacy | Meds/visit + Δ, top active ingredients, top brands |
| `/doctors` | Doctor & Specialty | Visits by specialty, sortable doctor matrix |
| `/diagnostics` | Labs & Scans | Labs/visit + Scans/visit + Δ, top lab tests, top scans |
| `/trends` | Trends | Multi-line avg per visit by month, dynamic Δ strip |
| `/login` | Login | Supabase email/password authentication |
| `/users` | Users | Admin-only Viewer account management |
| `/admin/import` | Data Import | Admin-only monthly workbook import |
| `/admin/patient-master` | Patient Master | Admin-only patient master import |
| `/chronic/import` | Chronic Import | Admin-only chronic workbook import |

## Authentication and roles

HealPath uses Supabase Auth with two roles:

- **Administrator** — full dashboard, export, import, and user-management access.
- **Viewer** — access to every dashboard, Settings, filters, search, and exports;
  all import and user-management pages and APIs are denied.

Navigation visibility, middleware authorization, and server/API checks enforce
the same policy. Disabled Viewer accounts cannot sign in, and authenticated
users receive a dedicated `403` screen for restricted URLs.

## Metric parity

All measures come straight from the `.pbix`, confirmed against the model:

```
Avg Meds per Visit  = DIVIDE(COUNT(Drug_Fact[brand]),  DISTINCTCOUNT(Visit[VisitID]))
Avg Labs per Visit  = DIVIDE(COUNT(Lab_Fact[Tests]),   DISTINCTCOUNT(Visit[VisitID]))
Avg Scans per Visit = DIVIDE(COUNT(Scan_Fact[Tests]),  DISTINCTCOUNT(Visit[VisitID]))
Visits              = DISTINCTCOUNT(Visit[VisitID])
Patients            = DISTINCTCOUNT(Visit[Patient Id])
```

DAX `COUNT` on a text column ignores blanks, so the SQL counts non-blank rows.
Month-over-month deltas are computed dynamically (latest month vs the one before
it) rather than hardcoded to fixed month names — so they stay correct as new
data arrives. See `lib/queries.ts`.

The analytic window is **2026 only** (Jan–Jun 2026).

## Data-quality handling

The raw extract has two issues the import step corrects:

1. **VisitID whitespace** — ids carry stray leading/trailing and doubled internal
   spaces that break the join to the fact tables. Every id is trimmed and its
   internal whitespace collapsed on both the dimension and the fact side.
2. **Corrupt MonthYear** — a large block of rows decodes to year 1970 even though
   the visit is really January 2026. `month_year` is derived from the reliable
   `Year` + `MonthName` fields, not the corrupt pre-computed column.

## Local setup

```bash
npm install
npm run dev          # http://localhost:3000, runs on the bundled snapshot
```

## Deploy

1. Push the repo to GitHub and import it into Vercel.
2. Set the env vars in Vercel project settings (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `DATABASE_URL` (server only)
3. Run `supabase/schema.sql` once against the Supabase project.
4. Run `supabase/migrations/20260825000100_add_healpath_rbac.sql` once.
5. Create `ahmedramadan@healpath.care` in Supabase Auth; the migration trigger
   makes it the active primary Administrator. Every other Auth user defaults to
   an inactive Viewer and should normally be created from `/users`.
6. Run the monthly import (below) to load the extract.

## Monthly refresh runbook

```bash
npm run import -- path/to/HealPath_BI_Starter.xlsx
```

The import script:
1. Reads every sheet (Visit + the four fact tables).
2. Cleans VisitID and derives `month_year` from `Year` + `MonthName`.
3. Loads `visits` first, then the four fact tables so the FK holds.
4. Runs a reconciliation check — row counts and distinct `visit_id` must match
   the source workbook before the refresh is considered complete.

If reconciliation fails, the dashboard keeps serving the previous data; fix the
extract and re-run.

## Repo layout

```
app/            pages + api/ route handlers
components/     KpiCard, BarRank, TrendLine, Donut, DataTable, FilterBar, TrendArrow
lib/            supabase client, queries (the metric library), types
scripts/        import.ts (CSV/XLSX -> Supabase loader + reconciliation)
supabase/       data schema + RBAC migration
data/           snapshot2026.json (bundled fallback data)
```
