# HealPath Executive BI — Project Context

**Single source of truth for future AI sessions.** Last updated: 2026-07-05 (after Sprint 20).
Read this first. Where it disagrees with memory, trust the code — verify claims against the repo before acting.

---

## 1. Architecture

- **Framework:** Next.js 14.2.5 (App Router), React 18, TypeScript. Server components render pages; API routes are thin wrappers.
- **Styling:** hand-written CSS design system in `app/globals.css` (semantic classes, premium executive look from Sprint 3). **No Tailwind, no PostCSS.** Do not introduce them.
- **Charts:** `recharts` for the donut; custom inline SVG for `TrendLine` and `BarRank`.
- **Data layer (`lib/queries.ts`)** — every metric function returns a fixed shape and has two sources:
  - **Live:** `lib/pg.ts` → direct **parameterised, read-only** Postgres over the Supabase **Session Pooler**, verified TLS (`certs/prod-ca-2021.crt`, `rejectUnauthorized` on). Bind params only — no string interpolation of user input. Shared `VISIT_FILTER` binds `$1` month, `$2` specialty, `$3` doctor, `$4` drug (visits containing an active ingredient/brand), `$5` disease (visits containing an ICD block); any per-query LIMIT is `$6`. `getTrends` binds `$1` specialty, `$2` doctor, `$3` drug, `$4` disease. `resolveFilters(searchParams, honor)` computes effective filters (selection > URL > default).
  - **Fallback:** `data/snapshot2026.json` (bundled). Used automatically when `hasDb` is false or a live query throws.
- **API routes** (`app/api/*`): call the same `lib/queries` functions → **API contracts are stable regardless of live/snapshot source.**
- **`lib/supabase.ts`** (PostgREST client) and the exported `SQL` object in `lib/queries.ts` are now **dead code** (the `exec_sql` path was abandoned — see Decisions). Left in place; do not depend on them.
- **Auth:** login page sets a client-side cookie `hp_auth=1` (not real authentication). `DASHBOARD_PASSWORD` env exists but the flow is cosmetic.
- **Import tooling:** `scripts/import.ts` (original supabase-js loader, superseded) and `scripts/pg-import.mjs` (direct-pg loader used in Sprint 6).

### Key files
| Path | Role |
|---|---|
| `lib/queries.ts` | All metric functions (live + snapshot fallback) |
| `lib/pg.ts` | Pooled direct Postgres, verified TLS |
| `app/globals.css` | Entire design system (frozen since Sprint 3) |
| `scripts/pg-import.mjs` | Data loader + validation |
| `certs/prod-ca-2021.crt` | Supabase CA (needed at runtime for TLS) |
| `.env.local` | `DATABASE_URL` (pooler), Supabase URL + keys — secrets |
| `data/snapshot2026.json` | Fallback dataset (mirrors the Power BI model) |

---

## 2. Function → source status (verified in code)

| Function | Source | Used by |
|---|---|---|
| `getKpis` | **LIVE** | Overview, Pharmacy, Doctors, Diagnostics |
| `getDiseases` | **LIVE** | Overview, Diseases |
| `getDiseaseDescriptions` | **LIVE** | Diseases |
| `getDrugs` | **LIVE** | Overview, Pharmacy |
| `getTrends` | **LIVE** | Overview, Pharmacy, Doctors, Diagnostics, Trends |
| `getDiagnostics` | **LIVE** | Labs & Scans |
| `getSpecialties` | **LIVE** | Doctors |
| `listMonths` / `listSpecialties` / `listDoctors` | **LIVE** (async-warmed cache) | Filter dropdowns — sync `(): string[]` contract; async-warmed module cache with snapshot fallback (Sprint 14; `listDoctors` added Sprint 15, fallback = snapshot top-20 doctors) |

**Global filters (Sprint 15):** Month, Specialty, **Doctor** — all via URL query params (`?month=&specialty=&doctor=`), shareable, and combinable. Every metric function accepts a `doctor` filter (`Filters.doctor` / `getTrends(specialty, doctor)`). `getTrends(specialty)` callers unaffected (doctor is an optional 2nd arg). As of Sprint 18B, Doctor chart clicks use the canonical `?doctor=` param, Nav preserves URL state across pages, and DashboardContext/URL/Doctor dropdown stay synchronized.

**Cross-filter selection (Sprint 16 infra + Sprint 17 activated):** `lib/dashboard-context.tsx` provides a global `DashboardProvider` (wraps the app in `app/layout.tsx`) holding a single `selection: { type: 'drug'|'disease'|'doctor'|'specialty', value } | null` (`select()` toggle / `clear()`), read via `useDashboard()`. `BarRank`/`Donut` are client components; with a `kind` prop their rows/slices are clickable (`role=button`, `aria-pressed`, `data-selected`, cursor). A click updates the context (pressed visual) **and reflects the single selection into the URL as `?sel=<type>&selv=<value>`** so the server pages re-fetch. Server pages call `resolveFilters(searchParams, honor)` which applies **priority: selection (`?sel`) > URL dropdown (`?month/specialty/doctor`) > default**. Doctor/specialty selections reuse the doctor/specialty filter (behave exactly like the dropdown). Drug/disease are visit-population filters. Re-click clears `?sel` (back to parity). Labs/scans bars stay non-clickable.

**Sprint 18A exception/upgrade:** Doctor chart clicks now behave exactly like the Doctor dropdown: they set `?doctor=<name>` and re-click clears `?doctor`; stale `?sel/?selv` is cleared. `FilterBar` mirrors `?doctor=` into `DashboardContext`, so the chart pressed state, URL, and dropdown are synchronized.

**Trend tooltip (Sprint 18A):** `TrendPoint` includes `visits` in live data, and `TrendLine` tooltips show Month, Visits, Avg Meds / Visit, Avg Labs / Visit, Avg Scans / Visit. The existing `TrendResponse.delta` is passed to `TrendLine` and displayed on the latest point only; no new delta calculation was added.

**Sprint 18B regression fixes:** `Nav` preserves `month`, `specialty`, `doctor`, `sel`, and `selv` on every page link. Doctor row active state is URL-driven (`?doctor=`) so stale DashboardContext cannot clear a doctor when the URL is empty. Doctor row clicks use the dropdown-equivalent URL path and trigger live server data on pages that honor doctor filtering. `TrendLine` now attaches the existing tooltip text to a larger transparent SVG hover target so the native tooltip is reachable without changing chart visuals.

**Universal search (Sprint 19):** one reusable `components/SearchBox.tsx` (client) on Diseases / Pharmacy / Diagnostics / Doctors. Debounced 300ms, min 2 chars → `GET /api/search?scope&q` → `searchOptions(scope, q)` (SQL **ILIKE** live / snapshot **includes** fallback). Dropdown shows up to 8 hits with **highlighted** match + **keyboard nav** (↑↓/Enter/Esc). Selecting a hit sets `?q=<value>` (preserving other params); pages read it via `resolveFilters` → `Filters.search` and the search-enabled queries filter with `ILIKE $7`. Search scopes: Diseases = `icd_desc` + `diseases` (ICD code); Pharmacy = `ac`/`brand`/`medications`; Diagnostics = `lab_fact.tests`/`scan_fact.tests`; Doctors = `practitioner_name`/`doctor_specialty`. The old `DataTable` client-side search was removed on Diseases/Doctors (SearchBox replaces it). `?q` is **not** preserved across `Nav` (page-local search).

**Executive insights (Sprint 20):** Overview now renders a deterministic executive insights section above the KPI grid. It contains an alert bar generated from already loaded Overview data using only doctors, medications, labs, visits, Avg Medications / Visit, and Avg Labs / Visit. The former "doctors contributed" alert was removed and replaced with a Vitamin D lab insight that reuses existing `getDiagnostics` live data, showing current requests and Delta % when latest/previous month data is available. Biggest Movers ignores diseases and compares only Avg Medications / Visit, Avg Labs / Visit, and Doctors for the latest trend month vs the previous trend month, reusing `getTrends` data plus existing month-scoped `getKpis` calls. Smart Comparison appears only when `doctor` is selected; its calculation is unchanged (`getKpis(f)` vs `getKpis({ ...f, doctor: null })`) and its presentation was polished with premium cards/status chips. No new SQL, routes, API routes, database tables, filters, auth changes, or AI generation were added.

**Page honor matrix (which cross-filter each page applies):**
| Page | month | specialty | doctor | drug | disease |
|---|:-:|:-:|:-:|:-:|:-:|
| Overview | ✓ | ✓ | ✓ | ✓ | ✓ |
| Diseases | ✓ | ✓ | ✓ | ✓ | ✗ (is the disease view) |
| Pharmacy | ✓ | ✓ | ✓ | ✓ | ✓ |
| Labs & Scans | ✓ | ✓ | ✓ | ✗ | ✓ |
| Trends | — | ✓ | ✓ | ✓ | ✓ |
| Doctor & Specialty | ✓ | ✓ | ✗ (inert, Sprint 15) | ✗ | ✗ |

---

## 3. Page status

| Page | Route | Status | Notes |
|---|---|---|---|
| Overview | `/` | ✅ **Live + verified** (Sprint 7) | All data live |
| Disease & Diagnosis | `/diseases` | ✅ **Live + verified** (Sprint 8) | All data live |
| Pharmacy | `/pharmacy` | ✅ **Live + verified** (Sprint 10) | All data live |
| Trends | `/trends` | ✅ **Live + verified** (Sprint 12) | All data live |
| Doctor & Specialty | `/doctors` | ✅ **Live + verified** (Sprint 11) | All data live |
| Labs & Scans | `/diagnostics` | ✅ **Live + verified** (Sprint 9) | All data live |

Filter enumerations (`listMonths`/`listSpecialties`) are **live** as of Sprint 14 (async-warmed cache; snapshot fallback until warm/if DB down). **Every data provider is now live.**

---

## 4. Database status

- **Supabase Postgres**, schema **`healpath`**, exposed to the API (`public, graphql_public, healpath`); `service_role` has `usage` + table/sequence grants.
- **Tables & constraints:**
  - `visits` — PK `visit_id` (text). Cols: visit_id, patient_id, prescription_date (timestamptz), doctor_specialty, practitioner_name, month_no, month_year.
  - `diagnosis_fact`, `drug_fact`, `lab_fact`, `scan_fact` — PK `id` (bigint identity, auto), **FK `visit_id → visits.visit_id` (enforced)**.
- **Connection:** Session Pooler `aws-0-eu-west-1.pooler.supabase.com:5432`, user `postgres.<ref>`, TLS **verified via CA cert** (URL `sslmode` is stripped in code; `ssl:{ca}` is authoritative). The direct `db.<ref>.supabase.co` host is IPv6-only and does **not** resolve here — always use the pooler.
- **No `exec_sql` RPC** exists (intentionally — creating one was blocked as an RCE surface).

### Current row counts (loaded)
| Table | Rows | Workbook | Skipped |
|---|---:|---:|---:|
| visits | 86,329 | 86,329 | 0 |
| diagnosis_fact | 116,802 | 116,808 | 6 |
| drug_fact | 207,133 | 207,136 | 3 |
| lab_fact | 68,345 | 68,355 | 10 |
| scan_fact | 10,011 | 10,014 | 3 |

FK integrity clean (0 orphans post-load); 0 NULL `visit_id`.

---

## 5. Import status

- **Complete** via `scripts/pg-import.mjs` (Sprint 6). Source: `C:\Users\User\Downloads\HealPath_BI_Starter.xlsx`.
- 488,620 of 488,642 rows loaded in one transaction (~170s).
- **22 fact rows skipped** (6 distinct VisitIDs) — proven source referential gaps: their parent visits are absent from the `Visit` sheet (the 4 patient numbers have zero visits). Skipped by explicit user decision; **nothing fabricated**.
- To reach 100%: a corrected extract whose `Visit` sheet includes those 6 VisitIDs, then re-run the loader.

---

## 6. Business rules (must be preserved)

1. **2026 reporting window** — the Power BI model (and every live metric) is scoped to `month_year like '2026-%'` = **77,306 visits**. The DB also holds 2025-10/11/12 (9,023 visits) which the model **excludes**. Never drop this scope.
2. **DAX → SQL measures:** Visits = `count(distinct visit_id)`; Patients = `count(distinct patient_id)`; Avg Meds/Visit = `count(drug brand, non-null) / distinct visits`; Avg Labs/Scans analogous with `lab_fact.tests` / `scan_fact.tests`.
3. **VisitID cleaning:** trim + collapse internal whitespace.
4. **month_year** derived from `Year` + `MonthName`; corrupt `Year < 2000` (1970 block) folded to 2026; `prescription_date` nulled for those rows.
5. **Blank text → NULL.**
6. **Filter nuances that reproduce the model exactly:**
   - Active ingredients (`drug_fact.ac`): exclude `NULL`, `''`, and `'0'`.
   - ICD **descriptions** (`diagnosis_fact.icd_desc`): exclude only `NULL`/blank — **keep the literal `'0'`** (the model has "0" = 3,336).
   - Brands: `lower(btrim(brand))`, exclude NULL/blank.
   - Specialty URL filters are trimmed before binding to live SQL because the model snapshot includes `Chest and Respiratory\n` while the DB stores `Chest and Respiratory`.
7. **Top-N limits:** ingredients 15, brands 10, ICD descriptions 15, ICD blocks per call (Overview 5, Diseases 10), labs 10, scans 10, doctor matrix 20.
8. **"Heal Path Polyclinic (Chronic)/(Telehealth)"** as a `Practitioner Name` is a **legitimate business identifier** (clinic booked as practitioner), not corrupt data.
9. **Doctor filter scope (Sprint 15):** the global Doctor filter (URL `?doctor=`, matched on `v.practitioner_name`, trimmed before binding) affects **Overview, Diseases, Pharmacy, Diagnostics, Trends**. The Doctors page renders the dropdown (global) but intentionally does **not** apply it (it doesn't parse `doctor`), so its ranking/matrix are unchanged.

---

## 7. Current decisions (standing)

- **Live data = direct parameterised `pg`**, NOT an `exec_sql`/arbitrary-SQL RPC (security: RCE surface on shared DB — explicitly avoided/blocked). Do not create arbitrary-SQL functions.
- **No shared-infra/DB-object changes** for live conversion — queries live in the app.
- **One page at a time**; snapshot fallback retained everywhere; conversions are **data-layer only**.
- **UI/CSS are frozen** at the Sprint 3 design. Sprints 7+ change only `lib/queries.ts` / `lib/pg.ts` / config.
- **API contracts are fixed** — never change return shapes.
- `listMonths`/`listSpecialties` stay **synchronous snapshot** (changing to async breaks callers).
- Orphan rows: **skip + document**, never fabricate parent visits.

---

## 8. Completed sprints

| Sprint | Outcome | Report |
|---|---|---|
| (pre) Env fix | Resolved stale `.next` causing "unstyled" render | `docs/ENVIRONMENT_VERIFICATION.md` |
| 3 | Premium executive design system (globals.css) + Nav/TrendArrow/BarRank/TrendLine polish | `docs/SPRINT3_REPORT.md` |
| 4 & 5 | Doctor + Pharmacy executive dashboards (presentation/composition, reused components) | `docs/SPRINT4_5_REPORT.md` |
| 6 | Imported production data into Supabase (`pg` loader) | `docs/DATA_IMPORT_REPORT.md` |
| 7 | Overview → live (`getKpis/getDiseases/getDrugs/getTrends`), created `lib/pg.ts` | `docs/SPRINT7_REPORT.md` |
| 8 | Disease & Diagnosis → live (`getDiseaseDescriptions`) | `docs/SPRINT8_REPORT.md` |
| 9 | Labs & Scans → live (`getDiagnostics`) | `docs/SPRINT9_REPORT.md` |
| 10 | Pharmacy live verification (`getKpis/getDrugs/getTrends`) | `docs/SPRINT10_REPORT.md` |
| 11 | Doctor & Specialty → live (`getSpecialties`) | `docs/SPRINT11_REPORT.md` |
| 12 | Trends live verification (`getTrends`) | `docs/SPRINT12_REPORT.md` |
| 13 | Power BI parity audit; fixed high-severity specialty filter newline mismatch | `docs/POWERBI_PARITY_REPORT.md` |
| 14 | `listMonths`/`listSpecialties` → live (async-warmed cache, sync contract preserved) — **last snapshot providers converted** | `docs/SPRINT14_REPORT.md` |
| 15 | Global **Doctor filter** (URL param) across Overview/Diseases/Pharmacy/Diagnostics/Trends; added `listDoctors`; all SQL still parameterised | `docs/SPRINT15_REPORT.md` |
| 16 | Cross-filter **interaction infrastructure** — global `DashboardContext`; chart clicks (drug/disease/doctor/specialty) emit a shared selection (no analytics consumption yet) | `docs/SPRINT16_REPORT.md` |
| 17 | **Activated cross-filtering** — selection reflected to `?sel/?selv`, consumed server-side via `resolveFilters` (priority selection > URL > default); drug/disease visit-population filters; honor matrix per page; re-click clears | `docs/SPRINT17_REPORT.md` |
| 18A | Rich trend point tooltip + Doctor chart/dropdown/URL synchronization (`?doctor=` canonical) | `docs/SPRINT18A_REPORT.md` |
| 18B | Fixed Doctor URL refresh/persistence regressions and Trend tooltip hover target | `docs/SPRINT18B_REPORT.md` |
| 19 | **Universal search** — reusable `SearchBox` autocomplete (ILIKE live / includes snapshot, debounce, min-2, highlight, keyboard nav) + `/api/search` + `?q` page filtering on Diseases/Pharmacy/Diagnostics/Doctors | `docs/SPRINT19_REPORT.md` |
| 20 | **Executive Insights Panel** on Overview: deterministic alert bar, medication/lab/doctor Biggest Movers, and doctor Smart Comparison | `docs/SPRINT20_REPORT.md` |

---

## 9. Remaining sprints

1. **Optional data completeness:** load the 22 missing rows from a corrected extract.
2. **Cleanup (later):** remove dead `lib/supabase.ts` + `SQL` object; decide when to retire the snapshot (still required as the live fallback).

> Cross-filtering is active. URL state (`month`, `specialty`, `doctor`, `sel`, `selv`) is preserved across `Nav` navigation as of Sprint 18B.

> All snapshot-based data providers are now live. The snapshot remains only as the automatic fallback.

---

## 10. Known issues / caveats

- **22 fact rows unimported** — DB is 22 rows short of the workbook by design (source referential gaps). Documented in `docs/DATA_IMPORT_REPORT.md`.
- **`listMonths`/`listSpecialties`** are live via an **async-warmed cache** (Sprint 14): the sync accessors return the snapshot on the very first call(s) after a cold start, then the live values once the background query resolves (typically the next request). This is intentional (the sync contract forbids awaiting) and imperceptible — live months are identical to the snapshot, and live specialties differ only by the correct trimmed `Chest and Respiratory` (vs the snapshot's `\n`).
- **Low-severity parity gaps:** a few month-filtered Top-N visuals have tied rows in a different order than Power BI. Counts and labels match; documented in `docs/POWERBI_PARITY_REPORT.md`.
- **Doctor filter on the Doctors page is inert** by design (Sprint 15 scope): the dropdown/selection show there (global FilterBar + clickable doctor bars) but the page doesn't apply a doctor filter, so selecting a doctor there has no effect on that page's ranking/matrix. As of Sprint 18B, clicking a doctor still synchronizes DashboardContext, URL, and the Doctor dropdown via `?doctor=`, and that URL state persists when navigating to pages that do apply the doctor filter.
- **Selection vs dropdown priority (Sprint 17/18B):** an active chart selection overrides the same-dimension dropdown for `?sel/?selv` dimensions (e.g. selecting a specialty bar overrides `?specialty=`). Clearing the selection (re-click) restores the dropdown value. Doctor is the exception: doctor chart clicks use `?doctor=` and behave exactly like the Doctor dropdown.
- **Login is cosmetic** (client-side cookie), not real auth.
- **Dead code:** `lib/supabase.ts` and the `SQL` export in `lib/queries.ts` (exec_sql path abandoned).
- **Runtime DB connection:** direct `pg` from the Next server works locally via the pooler; for a serverless deployment, size the pooler connection limits and ensure `certs/prod-ca-2021.crt` ships with the app. `DATABASE_URL` must be the **Session Pooler** URI (direct host is IPv6-only and unreachable here).
- **Dev-server hygiene:** running `next build`/`next dev`/`next start` against the same `.next` concurrently corrupts the cache (caused an earlier "unstyled" scare). Stop other servers before building.
- **Environment:** Windows; use the Bash tool with the pooler for DB scripts. `dotenv`, `pg`, `@types/pg` are installed; `pg` is a runtime dependency.

---

*End of context. Keep this file updated at the end of each sprint.*
