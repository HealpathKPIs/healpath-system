# Sprint 18B - Doctor Sync Regression Fixes

**Date:** 2026-07-05
**Objective:** Fix Sprint 18A regressions without redesigning or refactoring.
**Result:** Doctor selection now refreshes live data through the URL, persists across navigation, and Trend tooltips have a reachable hover target.

## Fixes

### Doctor Selection Refresh

- Doctor row clicks continue to use canonical `?doctor=<name>`.
- Doctor row clicks now use dropdown-equivalent navigation semantics.
- Doctor active state is URL-driven, so stale `DashboardContext` can no longer make a doctor row clear itself when the URL has no doctor.
- Stale `?sel/?selv` values are still cleared when selecting a doctor.

### Cross-Page Persistence

`components/Nav.tsx` now preserves the dashboard URL state on every page link:

- `month`
- `specialty`
- `doctor`
- `sel`
- `selv`

The URL remains the source of truth across page navigation.

### Trend Tooltip Hover

`components/TrendLine.tsx` still uses the Sprint 18A tooltip text, but it is now attached to a larger transparent SVG hover target around each visible dot. The chart visuals were not changed.

## Files Touched

- `components/Nav.tsx`
- `components/BarRank.tsx`
- `components/TrendLine.tsx`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT18B_REPORT.md`

## Build

`npm.cmd run build` passed with all 16 routes generated.

An initial build attempt exposed the App Router Suspense requirement for `useSearchParams()` in the layout-level nav. The final implementation scopes `useSearchParams()` inside a nav Suspense boundary and the final build passes.

## Verification

Browser verification was run against a clean dev runtime after clearing stale `.next` corruption.

Demonstrated flow:

- Baseline Pharmacy Total Visits: `77,306`
- Doctor chart click selected `Mohamed Elshahat`
- URL became `/doctors?doctor=Mohamed+Elshahat`
- Doctor dropdown showed `Mohamed Elshahat`
- Stale `sel` / `selv` were absent
- Nav links preserved `?doctor=Mohamed+Elshahat`
- Overview preserved the same doctor in URL and dropdown
- Pharmacy preserved the same doctor in URL and dropdown
- Pharmacy Total Visits changed to `6,639`
- Trend tooltip target was present with required fields:
  - Month
  - Visits
  - Avg Meds / Visit
  - Avg Labs / Visit
  - Avg Scans / Visit

## Notes

- No CSS changes.
- No visual redesign.
- No architecture refactor.
- Doctors page remains intentionally inert to its own doctor filter; the selected doctor applies when navigating to pages that honor the doctor filter.
