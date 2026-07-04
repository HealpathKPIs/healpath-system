# Sprint 11 - Doctors Live Data

**Date:** 2026-07-04
**Objective:** Convert **only** the remaining Doctor & Specialty snapshot query to live Supabase SQL.
**Result:** Doctor & Specialty is fully live and verified. `getSpecialties` now reads Postgres with snapshot fallback preserved.

---

## What changed

Single source-code edit: `lib/queries.ts`.

`getSpecialties(f)` now runs two fixed, parameterised live queries through `dbQuery` / `hasDb`:

- specialty ranking from `healpath.visits`
- top-20 doctor matrix from `healpath.visits`, `healpath.drug_fact`, and `healpath.lab_fact`

Both queries use the shared 2026 reporting filter:

```sql
v.month_year like '2026-%'
and ($1::text is null or v.month_year = $1)
and ($2::text is null or v.doctor_specialty = $2)
```

The top-20 doctor matrix pre-aggregates drug and lab counts separately before calculating per-visit rates. This avoids multiplying rows when a visit has both multiple drugs and multiple labs.

Snapshot fallback is unchanged: if the live query is unavailable or fails, `getSpecialties` still returns `snapshot.specialty` and `snapshot.doctors`.

---

## Fidelity details

- Doctor matrix keeps the existing `DoctorRow` contract: `practitioner`, `specialty`, `visits`, `medsPerVisit`, `labsPerVisit`.
- No scans-per-doctor field was added.
- Clinic practitioner names such as `Heal Path Polyclinic (Chronic)` and `Heal Path Polyclinic (Telehealth)` are kept as valid practitioner labels.
- For practitioner names that span specialties, the displayed specialty is the practitioner's highest-volume specialty in the filtered set, matching the model.
- Doctor per-visit rates use exact integer count math with half-even rounding to match Power BI for `.x85` cases.
- The legacy `Chest and Respiratory\n` specialty label is preserved in ranking output to match the model snapshot exactly.

No UI, CSS, components, API route, architecture, or API response shape changed.

---

## Verification

One verification pass compared live Supabase `getSpecialties` output against the Power BI snapshot reference for:

- all 2026 data
- each month from `2026-01` through `2026-06`

All comparisons passed:

| Slice | Specialty ranking | Doctor matrix |
|---|---|---|
| all | match | match |
| 2026-01 | match | match |
| 2026-02 | match | match |
| 2026-03 | match | match |
| 2026-04 | match | match |
| 2026-05 | match | match |
| 2026-06 | match | match |

All-2026 top rows:

| Item | Live / model |
|---|---|
| Top specialty | Internal Medicine - 22,363 visits |
| Top doctor | Mohamed Elshahat - 6,639 visits |
| Top doctor meds/visit | 2.07 |
| Top doctor labs/visit | 1.80 |

---

## Build

`npm.cmd run build` passed: compiled successfully, type checks passed, and 16/16 routes generated.

---

## Remaining

- Trends is already live through `getTrends`, but still needs independent page verification.
- `listMonths` / `listSpecialties` remain synchronous snapshot helpers by design.
