# Sprint 38 - Executive Charts

**Date:** 2026-07-15
**Scope:** Chronic chart interaction only. No chart-calculation, query, API, import, or business-logic changes.

## Objective

Every chronic chart should support an executive drill view with a larger chart, navigation controls, better tooltip behavior, legend, and export actions.

## Delivered

- Added `app/chronic/ExecutiveChartDrill.tsx`, a reusable client-side drill wrapper for chronic charts.
- Wired drill view to:
  - `/chronic` Clinical Outcome charts.
  - `/chronic/analytics` trend charts.
  - `/chronic/analytics` BarRank chart cards.
  - `/chronic/analytics` distribution tile charts.
- Modal behavior:
  - 80% viewport width.
  - Large line or horizontal bar chart.
  - Zoom in / zoom out.
  - Pan left / pan right.
  - Reset Zoom.
  - Better hover tooltip.
  - Legend.
  - Download PNG.
  - Download CSV.
  - Close button.
  - Esc closes.
  - Click outside closes.
  - Keyboard-openable chart surface.
- Responsive modal sizing with max height and scroll protection for long bar charts.

## Verification

- `npm.cmd run build` passed.

## Notes

- Existing chart calculations were not changed.
- Existing chart data is passed into the drill component as-is.
- No API, query, import, or database changes were made.
