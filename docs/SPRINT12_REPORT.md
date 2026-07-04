# Sprint 12 - Trends Live Data

**Date:** 2026-07-04
**Objective:** Convert/confirm **only** the Trends page as live Supabase data.
**Result:** Trends is fully live and verified. No source-code change was needed because `getTrends` was already converted to live direct Postgres in Sprint 7.

---

## What the page uses

`app/trends/page.tsx` calls exactly one data function:

| Function | Feeds | Live status |
|---|---|---|
| `getTrends(specialty)` | monthly meds/labs/scans per visit, deltas, arrows | Live since Sprint 7 |

`app/api/trends/route.ts` calls the same `getTrends` function and keeps the existing `TrendResponse` contract:

- `points`
- `delta`
- `arrows`

---

## Scope result

No source-code change was required for Trends because `lib/queries.ts` already uses:

- `dbQuery` / `hasDb` from `lib/pg.ts`
- fixed SQL
- positional parameter `$1` for optional specialty
- the 2026 reporting filter: `v.month_year like '2026-%'`
- snapshot fallback to `snapshot.trend`

No UI, CSS, components, architecture, API route, or API response shape changed.

---

## Power BI comparison

One verification pass compared live Supabase `getTrends(null)` output against the Power BI snapshot reference.

All six monthly points matched:

| Month | Meds | Labs | Scans |
|---|---:|---:|---:|
| 2026-01 | 2.71 | 0.75 | 0.13 |
| 2026-02 | 2.58 | 0.68 | 0.11 |
| 2026-03 | 2.62 | 0.62 | 0.10 |
| 2026-04 | 2.18 | 1.08 | 0.14 |
| 2026-05 | 2.20 | 1.00 | 0.12 |
| 2026-06 | 1.89 | 0.94 | 0.13 |

Delta versus previous month also matched:

| Measure | Live | Power BI model |
|---|---:|---:|
| Meds | -0.31 | -0.31 |
| Labs | -0.06 | -0.06 |
| Scans | 0.01 | 0.01 |

Arrows from those deltas:

- Meds: decrease
- Labs: decrease
- Scans: increase

---

## Build

`npm.cmd run build` passed after Sprint 12 documentation updates.

---

## Remaining

- `listMonths` / `listSpecialties` remain synchronous snapshot helpers by design.
- Optional cleanup can remove dead `lib/supabase.ts` and the exported `SQL` object after deciding when to retire the snapshot.
