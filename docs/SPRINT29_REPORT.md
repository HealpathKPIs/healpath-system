# Sprint 29 Report - Executive Performance Matrix

Date: 2026-07-10

## Scope

Created one new page: `/performance`.

The implementation is presentation/application composition only. It reuses existing live queries and existing dashboard primitives. No backend logic, SQL, APIs, API contracts, or navigation redesign were added.

## Implemented

- Executive KPI cards for highest Avg Medications, highest Avg Labs, highest Avg Scans, and highest Visits.
- Three supported tabs only: Doctors, Specialties, and Medications.
- One reusable page-local matrix component powers every tab.
- Reused `FilterBar` for Month, Specialty, and Doctor filters.
- Reused `SearchBox` for active-tab search.
- Reused `DashboardContext` and the existing Executive Scenario panel for row clicks.
- Matrix columns render the active month filter or the Jan-Jun 2026 month set.
- Metric selector supports Visits, Avg Medications, Avg Labs, and Avg Scans.
- Sorting supports all four metrics in ascending or descending order.
- Heatmap cells use existing neutral/accent design tokens.
- Cell hover/focus shows a premium tooltip with Entity, Month, Visits, Avg Medications, Avg Labs, and Avg Scans.

## Explicit Exclusions

- Laboratories tab was not implemented.
- No SQL was added.
- No backend code was added.
- No APIs were added or redesigned.
- No navigation/sidebar change was made.
- No duplicated per-tab matrix UI was created.

## Files Changed

- `app/performance/page.tsx`
- `app/performance/PerformanceMatrixClient.tsx`
- `components/ExecutiveExperience.tsx`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT29_REPORT.md`

## Verification

Build once and verify once:

- Tab switching: Doctors / Specialties / Medications share the same component.
- Metric switching: matrix cell values update between Visits, Avg Medications, Avg Labs, Avg Scans.
- Heatmap: cell intensity is computed from the selected metric.
- Search: `SearchBox` filters rows inside the active tab.
- Sorting: sort metric and direction update row order.
- Hover tooltip: cells expose entity, month, and all four metrics.
- Executive Scenario integration: row click updates `DashboardContext` and opens the existing scenario panel.
