# Sprint 33 Report - Chronic Executive Overview

Date: 2026-07-13

## Scope

- Replaced the `/chronic` placeholder with a premium executive overview for Chronic Care.
- Added `getChronicOverview` in `lib/queries.ts` to aggregate Sprint 32 chronic import tables.
- Added filters for Month, Week, Consultant, Recommendation, Issue, and Patient Search.
- Added top executive cards for:
  - Patients
  - Medications
  - Issues
  - Recommendations
  - Avg Medications / Patient
- Each KPI card includes current value, Week-over-Week percentage, mini trend, and animated numbers.
- Added deterministic Executive Summary.
- Added Executive Alerts for material changes only.
- Added Pre-to-Post Biggest Movers: Top Improvements and Top Regressions.
- Added charts for Patients Trend, Issue Trend, Recommendation Trend, Top Issues, and Top Recommendations.
- Added `/chronic/loading.tsx` skeletons.

## Guardrails

- No Patient Explorer.
- No Matrix.
- No drill-down.
- No app redesign.
- No dashboard changes.
- No import behavior changes.

## Files

- `app/chronic/page.tsx`
- `app/chronic/loading.tsx`
- `lib/queries.ts`
- `components/BarRank.tsx`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT33_REPORT.md`

## Verification

- Build once: passed after clearing a stale `.next` runtime cache and rebuilding cleanly (`npm.cmd run build`).
- `/chronic` rendered successfully.
- Filtered URL rendered successfully: `/chronic?month=2026-08&week=2026-W32&patient=SPRINT32`.
- Verified filters, KPI section, charts, movers/alerts, and Week-over-Week calculation guard.
- Stale runtime cache symptom observed before cleanup: missing `.next/server` chunk. Generated `.next` was removed and rebuilt; no source issue remained.
