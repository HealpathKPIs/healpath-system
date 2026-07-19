# Sprint 29A Report - Performance Matrix Expansion

Date: 2026-07-10

## Scope

Extended the existing `/performance` Performance Matrix. The matrix was not redesigned or rebuilt.

## Implemented

- Added two tabs to the existing matrix: Laboratories and Scans.
- Reused the same `MatrixRow` / `MatrixCell` interface already used by Doctors, Specialties, and Medications.
- Reused the same page-local matrix component for tab switching, metric switching, sorting, heatmap cells, hover/focus tooltip, and empty state.
- Laboratories and Scans default the active metric to Visits when opened.
- Reused `SearchBox` with the existing diagnostics search scope for lab and scan entities.
- Reused existing heatmap colors and premium tooltip behavior.
- Reused the existing Executive Scenario panel through DashboardContext plus the scenario-open event.

## Data

- Added one read-only query helper in `lib/queries.ts`: `getDiagnosticEntityKpis`.
- Laboratory rows use visits containing the selected `lab_fact.tests` value.
- Scan rows use visits containing the selected `scan_fact.tests` value.
- Metrics remain Visits, Avg Medications, Avg Labs, and Avg Scans.
- No schema changes, migrations, backend redesign, API changes, or routing changes were made.

## Files Changed

- `lib/queries.ts`
- `app/performance/page.tsx`
- `app/performance/PerformanceMatrixClient.tsx`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT29A_REPORT.md`

## Verification

Build once and verify once:

- Laboratories tab exists.
- Scans tab exists.
- Search uses the active tab's diagnostics scope.
- Sorting uses the existing sort controls.
- Heatmap uses the existing selected-metric intensity path.
- Hover/focus tooltip still shows Entity, Month, Visits, Avg Medications, Avg Labs, and Avg Scans.
- Row click opens the existing Executive Scenario panel.
