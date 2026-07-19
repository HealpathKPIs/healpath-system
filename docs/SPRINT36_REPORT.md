# Sprint 36 - Chronic Performance Optimization

**Date:** 2026-07-15
**Scope:** `/chronic` loading performance only. No UI redesign, no API changes, no import changes, and no business-logic changes.

## Objective

Reduce `/chronic` page loading time dramatically while keeping the PRE vs POST dashboard output identical.

## Baseline Profile

Current `/chronic` used `getChronicOverview`, which executed:

| Query / Step | Result | Time |
|---|---:|---:|
| Chronic calendar query | 28 rows | 85 ms |
| Full chronic row fetch | 74,540 rows | 43,473 ms |
| Full `getChronicOverview({})` path | `/chronic` subset assembled in JS | 111,014 ms |

Root cause: the page fetched every chronic PRE/POST row, extracted Issue fields from `row_data`, shipped those rows to Node, and then built KPI cards, charts, catalogs, and operational KPIs in JavaScript.

## Implementation

- Wired `/chronic` to the optimized `getChronicPageData` path.
- Kept `getChronicOverview` available for `/chronic/analytics`.
- Replaced the `/chronic` row-fetch path with SQL aggregate datasets:
  - KPI aggregate query returns only phase totals.
  - Chart trend query returns only period-level PRE/POST chart points.
  - Issue catalog query returns grouped issue counts.
  - Recommendation catalog query returns grouped recommendation counts.
  - Operational KPI query returns grouped operational counts.
  - Filter option query returns compact distinct option values.
- `row_data` is used only inside SQL for issue extraction and operational matching; it is no longer fetched by the page.
- Removed duplicated page SQL execution by sharing one in-flight `getChronicPageData` promise across all `/chronic` Suspense sections.
- Added independent Suspense boundaries for filters, Executive Comparison, Clinical Outcome, Issue Comparison, Recommendation Comparison, and Operational KPIs.
- Preserved section order so KPI cards render before charts.

## Indexes Added

Created missing indexes on both `healpath.chronic_pre` and `healpath.chronic_post`:

- `patient_id`
- `period`
- `week`
- consultant expression from `row_data`
- `recommendation`
- `issue`

Existing primary keys and Week + Patient ID + Medication Name unique indexes were left intact.

## Optimized Query Profile

Post-optimization `/chronic` query profile:

| Query | Rows Returned | Time |
|---|---:|---:|
| KPI aggregate | 2 | 4,077 ms |
| Chart trend dataset | 14 | 4,296 ms |
| Filter option dimensions | 7,799 | 2,261 ms |
| Issue catalog counts | 194 | 2,235 ms |
| Recommendation catalog counts | 112 | 403 ms |
| Operational counts | 7 | 2,364 ms |
| Calendar options | 28 | 71 ms |

The aggregate queries are launched with `Promise.all`, so the page no longer waits for them serially.

## Result

| Measurement | Before | After |
|---|---:|---:|
| Data helper elapsed time | 111,014 ms | 9,439 ms |
| Full-row fetch volume | 74,540 rows | removed |
| Production `/chronic` HTTP render | not used as baseline | 15,135 ms |

The optimized helper is approximately **11.8x faster** than the previous full `/chronic` data path.

## Output Verification

Compared old `getChronicOverview({})` output to optimized `getChronicPageData({})` output:

- Metrics: match.
- Outcome trends: match.
- Issue catalog: match.
- Recommendation catalog: match.
- Operational KPIs: match.
- Period options: match.
- Consultant options: match.
- Issue options: match.
- Recommendation options: match.

Production route verification:

- `/chronic` returned HTTP 200.
- Rendered Patients PRE/POST: 6,290 / 6,288.
- Rendered Medications PRE/POST: 41,202 / 33,338.
- Rendered Issues PRE/POST: 31,919 / 19,713.
- Rendered Clinical Outcome, Fixed Issue Catalog, and Fixed Recommendation Catalog sections.
- Server logs showed no runtime errors.

Build:

- `npm.cmd run build` passed.
