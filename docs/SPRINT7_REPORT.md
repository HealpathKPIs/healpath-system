# Sprint 7 — Live Supabase Data (Overview)

**Date:** 2026-07-04
**Objective:** Replace the bundled snapshot with live, SQL-backed Supabase data — **Overview page only**.
**Result:** ✅ The Overview is served entirely by live SQL from Supabase. Every KPI, chart, and trend matches the Power BI model exactly. Snapshot retained only as an automatic fallback.

---

## Scope

Converted the four data functions the Overview depends on to live SQL, keeping identical return shapes (API contracts unchanged):

| Function | Feeds (Overview) | Now |
|---|---|---|
| `getKpis` | 5 KPI cards | Live SQL |
| `getDiseases` | Top-5 disease blocks | Live SQL |
| `getDrugs` | Top-5 active ingredients | Live SQL |
| `getTrends` | Avg-per-visit trend chart | Live SQL |

Left on snapshot (their pages are future sprints): `getDiseaseDescriptions`, `getDiagnostics`, `getSpecialties`, and `listMonths`/`listSpecialties` (these are synchronous enumeration helpers whose `(): string[]` signature must not change).

---

## Approach

**Direct parameterised Postgres (read-only), not an `exec_sql` RPC.** The existing code stubbed a `supabase.rpc('exec_sql', …)` call, but creating an arbitrary-SQL RPC on the shared production database is a remote-code-execution surface and was (correctly) blocked. Instead, each metric is a **fixed statement with positional bind parameters** run over the Supabase **Session Pooler** with **verified TLS** (Supabase CA, `rejectUnauthorized` on). User input (`month`, `specialty` from the URL) is passed as `$1`/`$2` binds and can never be interpolated into SQL. **No database/schema/infra objects were created or modified.**

**2026 reporting-window scoping (the key correctness finding).** The DB holds 86,329 visits, but the Power BI model (and the snapshot) is scoped to the **2026 reporting window** (77,306 visits); the extra 9,023 are 2025-10/11/12 rows the model excludes. Every live query constrains the base population to `month_year like '2026-%'`, which reproduces the model exactly. A specific `month`/`specialty` filter narrows within that window.

Each function falls back to the snapshot if the DB is unreachable or a query errors, so the dashboard degrades gracefully.

---

## Files changed

| File | Change |
|---|---|
| `lib/pg.ts` | **New.** Server-only pooled Postgres access, verified TLS via `certs/prod-ca-2021.crt`, `dbQuery(text, params)` helper. |
| `lib/queries.ts` | `getKpis`, `getDiseases`, `getDrugs`, `getTrends` → live parameterised SQL (2026 scope) with snapshot fallback; swapped `supabase` import for `pg`. |
| `next.config.js` | `experimental.serverComponentsExternalPackages: ['pg']` (externalise driver for server bundle). |
| `package.json` | Moved `pg` to `dependencies`; added `@types/pg` (dev). |

**Not touched:** any UI component, any CSS, the API route handlers (contracts preserved — routes still call the same functions), DB schema, and DB data.

---

## KPI verification vs Power BI model

Overview, no filter — live API/page vs the Power BI/snapshot model:

| Metric | Live (Supabase) | Power BI model | Match |
|---|---:|---:|:--:|
| Visits | 77,306 | 77,306 | ✅ |
| Patients | 29,128 | 29,128 | ✅ |
| Doctors | 61 | 61 | ✅ |
| Specialties | 19 | 19 | ✅ |
| Avg Meds / Visit | 2.42 | 2.42 | ✅ |
| Avg Labs / Visit | 0.84 | 0.84 | ✅ |
| Avg Scans / Visit | 0.12 | 0.12 | ✅ |

- **Trend (6 months):** all 6 points match — `2026-01 {2.71,0.75,0.13}` … `2026-06 {1.89,0.94,0.13}`.
- **Top active ingredients:** `PARACETAMOL 13,928 · FEXOFENADINE 7,719 · IVY LEAVES 4,831` (15 rows) — match.
- **Top brands:** `telfast 7,663 · doliprane 6,038 · panadol 4,065` (10 rows) — match.
- **Top disease blocks:** `Acute upper respiratory infections 13,701 · … · Other diseases of intestines 5,744` — match.

### Proof it is live, not the snapshot fallback
The snapshot ignores the `specialty` filter (returns all-2026), so a specialty query is the discriminator:

| Request | Live API | Direct DB cross-check | Snapshot would return |
|---|---|---|---|
| `?specialty=Internal Medicine` | visits **22,363**, patients 10,460, doctors 8, specialties 1, meds 2.31, labs 1.21, scans 0.05 | **identical** (22,363 / 10,460 / 8 / 2.31 / 1.21 / 0.05) | 77,306 (wrong — ignores specialty) |
| `?month=2026-03` | visits **8,849**, meds 2.62 | matches month distribution + trend | — |

The API/page return the correctly **filtered** values (not 77,306), and they equal an independent direct-DB computation — confirming the live path. No fallback warnings were logged.

---

## Build

`npm run build` → ✅ Compiled successfully, types valid, **16/16 pages generated**, no errors. Route sizes unchanged (data-layer-only change).

---

## Browser verification (once)

`next start` on the production build:
- Overview **page** (server component) HTML renders live KPI values `77,306 / 29,128 / 61 / 2.42 / 0.84`.
- `/api/kpis`, `/api/trends`, `/api/drugs`, `/api/diseases` return live values matching the model (above).
- No runtime error overlay; no snapshot-fallback warnings in the server log.

---

## Notes for the next sprints

- `getKpis`, `getTrends`, `getDrugs`, `getDiseases` are **shared** across pages, so Pharmacy / Diagnostics / Doctors / Diseases / Trends now also read live for those metrics — but only **Overview was verified** this sprint (one page at a time).
- Still snapshot-backed (to convert + verify per page): `getSpecialties` (Doctors), `getDiagnostics` (Labs & Scans), `getDiseaseDescriptions` (Diseases table). `listMonths`/`listSpecialties` are sync enumerations kept on the snapshot to preserve their contract.
- Runtime uses a direct pooled Postgres connection; for a serverless deployment, confirm the Session Pooler connection limits are sized to the platform.
