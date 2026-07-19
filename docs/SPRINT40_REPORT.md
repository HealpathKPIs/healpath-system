# Sprint 40 - Patient Explorer

**Date:** 2026-07-15
**Scope:** Read-only chronic patient explorer. No editing, API route, import, SQL/schema, authentication, or dashboard-calculation changes.

## Objective

Create `/chronic/patient` for patient-level chronic history review.

## Delivered

- Added `/chronic/patient`.
- Added Patient ID search.
- Added partial-match patient selection when the search does not resolve to one exact patient.
- Added read-only patient summary cards:
  - Patient ID and week count.
  - Medications PRE vs POST.
  - Issues PRE vs POST.
  - Recommendations PRE vs POST.
- Added PRE to POST timeline grouped by week.
- Added Medication Changes table.
- Added Issue History table.
- Added Recommendation History table.
- Added Week History table.
- Added a Patient action on `/chronic` using the existing header button style.

## Data Path

- Added `getChronicPatientExplorer` in `lib/queries.ts`.
- The helper first resolves patient matches, then fetches only the selected patient's PRE/POST chronic rows.
- Issue values are extracted from numbered Issue fields and canonicalized through the existing read-path logic.
- The route is read-only and does not expose editing controls.

## Verification

- `npm.cmd run build` passed.
- Build output includes `/chronic/patient`.
- Read-only probe with patient `50008479` returned:
  - Summary cards.
  - 10 timeline rows.
  - 4 medication changes.
  - 2 issue history items.
  - 4 recommendation history items.
  - 2 week history rows.

## Notes

- No API route was added.
- No import behavior changed.
- No database schema changed.
- No chronic dashboard KPI logic changed.
