# Sprint 34 - Chronic Query Audit

**Date:** 2026-07-14
**Scope:** Chronic query layer only. No UI redesign, import changes, SQL/schema changes, API changes, or authentication changes.

## Objective

The imported chronic data was correct in Supabase, but the dashboard KPI cards were not using the full dataset when Period was set to All. The visible symptom was the Patients card showing 663 instead of the expected 6,289.

## Root Cause

`getChronicOverview` treated a missing Period filter as the latest available period. That made the default `/chronic` view behave like a single-period dashboard instead of an All-period dashboard.

Issue filtering also depended on issue column labels instead of only the actual values stored inside the chronic issue fields.

## Fix

- Period = All now means all scoped chronic rows.
- Removed the hidden latest-period default for KPI totals.
- KPI totals now use the complete POST dataset unless a user filter is selected.
- Issue options are derived from issue values inside `Issue 1`, `Issue 2`, ... fields through internal extraction.
- Issue column names such as `Issue 1` / `Issue1` are suppressed from the dropdown.
- Selecting an Issue filters the chronic result set by extracted issue values.
- Aggregation is reused once from the chronic query layer and then derived in memory.

## Verified Totals

| KPI | Expected | Verified |
|---|---:|---:|
| Patients | 6,289 | 6,289 |
| Medications | 33,339 | 33,339 |
| Recommendations | 33,339 | 33,339 |
| Average Medications / Patient | 5.30 | 5.30 |
| Average Issues / Patient | 2.58 | 2.58 |

Direct chronic table audit:

- `chronic_post` rows: 33,339
- Distinct POST patients: 6,289
- POST medication values: 33,339
- POST recommendation values: 33,339

## Application Verification

Build:

- `npm.cmd run build`
- Result: passed.

Production route checks:

- Started the built app with `npm.cmd start -- -p 3034`.
- `/chronic` returned HTTP 200.
- `/chronic/import` returned HTTP 200.
- `/chronic` rendered Patients = 6,289.
- `/chronic` rendered Medications / Recommendations = 33,339.
- Issue dropdown output contained issue values and did not expose issue column names.
- `/chronic?issue=Acc%20to%20DAPT%20score` returned HTTP 200, preserved the selected issue, and produced filtered output different from All.
- Server stdout/stderr showed no runtime errors during verification.

## Notes

- One legacy POST row uses a week value that is not mapped in the chronic business calendar. The All view includes the full scoped POST dataset, while period-specific analytics still rely on configured calendar periods.
- No further optimization was performed after verification passed.
