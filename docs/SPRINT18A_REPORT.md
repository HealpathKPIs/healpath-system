# Sprint 18A - Trend Tooltip and Doctor Sync

**Date:** 2026-07-05
**Objective:** Continue the interrupted Sprint 18A implementation without restarting scope.
**Result:** Completed the rich trend tooltip and fixed Doctor chart/dropdown synchronization.

## Completed Before Resume

- Read `components/TrendLine.tsx`.
- Read `components/FilterBar.tsx`.
- Added `visits` to `TrendPoint`.
- Updated `getTrends()` SQL to select visits.

## Completed In This Pass

### Rich Trend Tooltip

`components/TrendLine.tsx` now adds native SVG tooltips on trend dots.

Each tooltip shows:

- Month
- Visits
- Avg Meds / Visit
- Avg Labs / Visit
- Avg Scans / Visit

The existing overall month-over-month delta from `TrendResponse.delta` is passed into `TrendLine` and displayed only on the latest point. No new delta calculation was added.

`lib/queries.ts` now maps the already-selected `visits` field into each live trend point.

### Doctor Click Synchronization

Doctor chart clicks now use the same canonical URL parameter as the Doctor dropdown:

- selecting a doctor chart row sets `?doctor=<name>`
- clicking the same doctor again clears `?doctor`
- doctor clicks clear stale `?sel/?selv`
- `FilterBar` mirrors the current `doctor` URL value into `DashboardContext`
- changing the Doctor dropdown also updates `DashboardContext` and clears stale selection transport

This keeps `DashboardContext`, URL, and the Doctor dropdown synchronized. A Doctor chart click now behaves like selecting the same doctor from the dropdown.

## Files Touched

- `lib/queries.ts`
- `lib/types.ts`
- `components/TrendLine.tsx`
- `components/FilterBar.tsx`
- `components/BarRank.tsx`
- `lib/dashboard-context.tsx`
- `app/page.tsx`
- `app/trends/page.tsx`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT18A_REPORT.md`

Pre-existing Sprint 16/17/18A files already present in the dirty worktree were preserved.

## Verification

Build:
`npm.cmd run build` passed. Next generated 16/16 routes successfully.

Focused verification:

- `getTrends()` live output includes visits on every trend point.
- First trend point: `2026-01`, `27,669` visits, meds `2.71`, labs `0.75`, scans `0.13`.
- Trend tooltip source includes Month, Visits, Avg Meds / Visit, Avg Labs / Visit, Avg Scans / Visit, and MoM Delta fields.
- Overview and Trends pass the existing `trends.delta` into `TrendLine`.
- Doctor chart clicks set/clear the canonical `doctor` URL param.
- Doctor chart clicks clear stale `sel/selv`.
- Doctor dropdown changes update `DashboardContext`.

## Notes

- No redesign was done.
- No unrelated files were touched.
- No new analytics calculations were introduced.
- The Doctor & Specialty page still does not apply the doctor filter to its own ranking/matrix; this remains the established page behavior. The synchronization fix keeps its chart click, URL, and dropdown state aligned.
