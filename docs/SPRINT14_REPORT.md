# Sprint 14 — Live Supabase Data (Filter Enumerations)

**Date:** 2026-07-04
**Objective:** Convert `listMonths` and `listSpecialties` — the **last remaining snapshot-based data providers** — to live PostgreSQL.
**Result:** ✅ Both are now served from Postgres (2026 window) with snapshot fallback. Every data provider in the app is now live.

---

## Constraint that shaped the design

`listMonths` / `listSpecialties` have a **synchronous** contract — `(): string[]` — and are called synchronously inside server components (`PageHead`, the Overview `FilterBar` Suspense). A `pg` query is asynchronous, and the rules forbid changing the contract, the callers, or the architecture. A sync function cannot `await`.

**Solution: an async-warmed, memoised module cache** (data-layer only):
- A background query (`refreshEnumerations`, fire-and-forget, memoised via `warmEnumerations()`) populates `monthsCache` / `specialtiesCache` from Postgres.
- The sync accessors return the live cache when present, else the bundled snapshot, and trigger the warm-up non-blocking on each call.
- Net effect: the first call(s) after a cold start return the snapshot; once the background query resolves (next request), the accessors return live values — with the snapshot as the permanent fallback if the DB is unreachable.

No caller, component, page, CSS, API contract, or architecture changed.

---

## Change

Single edit to `lib/queries.ts`, using the existing `lib/pg.ts` infrastructure (`dbQuery` / `hasDb`) and the standard 2026 reporting-window scope:

```sql
-- months
select distinct month_year from healpath.visits
where month_year like '2026-%' order by month_year;

-- specialties (trimmed — see fidelity note)
select distinct btrim(doctor_specialty) as s from healpath.visits
where month_year like '2026-%' and doctor_specialty is not null and btrim(doctor_specialty) <> ''
order by 1;
```

**Fidelity note:** the query scopes to the 2026 window so `listMonths` returns exactly `2026-01…2026-06` (the DB also holds 2025 rows the model excludes). Specialties are `btrim`-med, which yields the correct `Chest and Respiratory` — the snapshot stored `Chest and Respiratory\n`. This is consistent with the Sprint-13 trim-on-bind fix; selecting the clean value still binds correctly.

---

## Verification (once)

Direct server-side probe (`.env.local` loaded, `warmEnumerations()` awaited):

| Check | Cold (fallback) | After warm (live) |
|---|---|---|
| `listSpecialties()[1]` | `"Chest and Respiratory\n"` (snapshot) | `"Chest and Respiratory"` (live, trimmed) |
| Whitespace-edge entries | 1 (`\n`) | **0** |
| `listMonths()` | — | `["2026-01"…"2026-06"]` (6) |
| `listSpecialties()` count | — | **19** |

- **Live proof:** after warm-up the specialty list is the clean, trimmed DB set (no `\n`) — a value the snapshot cannot produce.
- **Fallback proof:** the cold call returns the snapshot (with `\n`), confirming graceful fallback before warm-up / if the DB is down.
- Live months and specialties match the Power BI model set exactly (months identical; specialties identical modulo the corrected trim).

Build: `npm run build` → ✅ compiled successfully, types valid, **16/16 routes**, no errors. Route sizes unchanged (data-layer-only change).

---

## Scope confirmation

- Modified only `listMonths` / `listSpecialties` (+ their private cache/warm helper) in `lib/queries.ts`.
- No UI, CSS, architecture, API contract, or shared-infra changes; `lib/pg.ts` reused as-is.
- Snapshot fallback preserved.
- **All snapshot-based data providers are now live.** The snapshot remains only as the automatic fallback.
