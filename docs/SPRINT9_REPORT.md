# Sprint 9 - Live Supabase Data (Labs & Scans)

**Date:** 2026-07-04
**Objective:** Convert **only** the Labs & Scans page-specific rankings from snapshot to live Supabase data.
**Result:** The Labs & Scans page is fully live. `getDiagnostics` now reads Postgres with snapshot fallback preserved.

---

## What the page needed

`app/diagnostics/page.tsx` uses three data functions:

| Function | Feeds | Status before | Action |
|---|---|---|---|
| `getKpis(f)` | Labs/visit and scans/visit KPIs | Already live (Sprint 7) | none |
| `getTrends(f.specialty)` | KPI deltas | Already live (Sprint 7) | none |
| `getDiagnostics(f)` | Top lab tests and top scans | Snapshot | live this sprint |

Exactly one function was converted: `getDiagnostics`.

---

## Change

Single edit to `lib/queries.ts`: `getDiagnostics` now runs two parameterised, read-only queries via the existing `lib/pg.ts` infrastructure (`dbQuery` / `hasDb`) and the shared `VISIT_FILTER`:

```sql
select l.tests as label, count(*)::int as value
from healpath.lab_fact l join healpath.visits v on v.visit_id = l.visit_id
where <2026 window + optional month/specialty>
  and l.tests is not null and btrim(l.tests) <> ''
group by l.tests order by value desc limit 10
```

The scan query is the same pattern against `healpath.scan_fact`.

Fallback behavior is unchanged: if `DATABASE_URL` is absent or the live query fails, the bundled snapshot still serves `{ labs, scans }`.

No page, component, CSS, API route, shared infrastructure, or API response shape changed.

---

## Verification

Direct server-side function probe with `.env.local`:

| Metric | Live result |
|---|---:|
| Avg Labs / Visit | 0.84 |
| Avg Scans / Visit | 0.12 |

Top live diagnostics:

| Rank | Lab test | Count |
|---:|---|---:|
| 1 | Complete Blood Count - CBC | 6,988 |
| 2 | Vitamin D | 4,352 |
| 3 | Haemoglobin A1C | 3,849 |
| 4 | Urine Analysis | 3,711 |
| 5 | SGPT (ALT) | 2,920 |

| Rank | Scan | Count |
|---:|---|---:|
| 1 | US ABDOMEN & PELVIS | 2,243 |
| 2 | MRI LUMBAR SPINE | 934 |
| 3 | MRI KNEE | 594 |
| 4 | MRI CERVICAL SPINE | 575 |
| 5 | X-Ray Knee 2 views | 486 |

Built-server API check:

`GET http://127.0.0.1:3100/api/diagnostics` returned 200 with first lab `Complete Blood Count - CBC` (6,988), first scan `US ABDOMEN & PELVIS` (2,243), `avgLabs` 0.84, and `avgScans` 0.12.

Temporary `next start` process on port 3100 was stopped after verification.

---

## Build

`npm.cmd run build` passed: compiled successfully, type checks passed, and 16/16 routes generated.

`npm.cmd run lint` was attempted, but this repo has no ESLint config yet, so `next lint` opened the interactive setup prompt. No lint configuration was added.

---

## Scope confirmation

- Modified only `getDiagnostics` in `lib/queries.ts`.
- Reused the existing direct Postgres pool and shared 2026 filter rules.
- Kept snapshot fallback and API contract stable.
- Still snapshot-backed for a future sprint: `getSpecialties` (Doctors), plus sync enumerations `listMonths`/`listSpecialties`.
