# Sprint 29B Report - Performance Matrix Aggregation Fix

Date: 2026-07-13

## Root Cause

The matrix built every cell with `getKpis(filters)`. When the live query path timed out or fell back, `getKpis` returned `snapFor(f).kpi`, which only reflected the selected month. Entity filters such as doctor, specialty, and medication were not represented in that snapshot KPI fallback, so each row repeated the same global monthly totals.

## Fix

- Added `getPerformanceEntityMetrics` in `lib/queries.ts`.
- The helper performs grouped Entity + Month aggregation for Doctors, Specialties, Medications, Laboratories, and Scans.
- Updated `app/performance/page.tsx` to call the grouped helper once per tab instead of calling `getKpis` once per entity cell.
- Kept the existing `MatrixRow` / `MatrixCell` interface and existing client matrix UI.
- Kept totals computed from each row's own cells.

## Guardrails

- No UI redesign.
- No routing changes.
- No API changes.
- No schema changes or migrations.
- No unrelated pages touched.

## Verification

- Build once.
- Verify at least three doctor rows have different monthly values.
