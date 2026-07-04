# Sprint 10 - Pharmacy Live Data

**Date:** 2026-07-04
**Objective:** Convert/confirm **only** the Pharmacy page as live Supabase data.
**Result:** Pharmacy is fully live and verified. No code change was needed because its data functions were already converted to live direct Postgres in Sprint 7.

---

## What the page uses

`app/pharmacy/page.tsx` calls exactly three data functions:

| Function | Feeds | Live status |
|---|---|---|
| `getKpis(f)` | Total visits, avg meds/visit | Live since Sprint 7 |
| `getDrugs(f)` | Top active ingredients, top brands | Live since Sprint 7 |
| `getTrends(f.specialty)` | Avg meds/visit delta | Live since Sprint 7 |

`app/api/drugs/route.ts` calls `getDrugs` and keeps the same `{ ac, brands }` contract.

---

## Scope result

No source code change was required for Pharmacy because `lib/queries.ts` already uses:

- `dbQuery` / `hasDb` from `lib/pg.ts`
- fixed SQL statements
- positional parameters only: `$1` month, `$2` specialty, `$3` limit
- the shared 2026 reporting filter: `v.month_year like '2026-%'`
- the existing snapshot fallback when the live query is unavailable or fails

No UI, CSS, components, architecture, or API contracts were changed.

---

## Power BI comparison

Verification used the bundled `data/snapshot2026.json` model snapshot as the Power BI reference and compared it to live Supabase function output with `.env.local` loaded.

| Metric | Live | Power BI model | Match |
|---|---:|---:|:--:|
| Visits | 77,306 | 77,306 | yes |
| Avg Meds / Visit | 2.42 | 2.42 | yes |
| Meds delta | -0.31 | -0.31 | yes |

Top active ingredients:

| Rank | Ingredient | Live | Power BI model |
|---:|---|---:|---:|
| 1 | PARACETAMOL | 13,928 | 13,928 |
| 2 | FEXOFENADINE | 7,719 | 7,719 |
| 3 | IVY LEAVES | 4,831 | 4,831 |
| 4 | MULTIVITAMINS | 4,594 | 4,594 |
| 5 | AZITHROMYCIN | 4,438 | 4,438 |

All 15 active-ingredient rows matched.

Top brands:

| Rank | Brand | Live | Power BI model |
|---:|---|---:|---:|
| 1 | telfast | 7,663 | 7,663 |
| 2 | doliprane | 6,038 | 6,038 |
| 3 | panadol | 4,065 | 4,065 |
| 4 | polymer | 3,218 | 3,218 |
| 5 | ivyrospan | 3,053 | 3,053 |

All 10 brand rows matched.

Meds trend matched for every month:

| Month | Live | Power BI model |
|---|---:|---:|
| 2026-01 | 2.71 | 2.71 |
| 2026-02 | 2.58 | 2.58 |
| 2026-03 | 2.62 | 2.62 |
| 2026-04 | 2.18 | 2.18 |
| 2026-05 | 2.20 | 2.20 |
| 2026-06 | 1.89 | 1.89 |

---

## Build

`npm.cmd run build` passed after Sprint 10 documentation updates.

---

## Remaining

- Doctor & Specialty still needs `getSpecialties` converted and verified.
- Trends is already live through `getTrends`, but still needs independent page verification.
- `listMonths` / `listSpecialties` remain synchronous snapshot helpers by design.
