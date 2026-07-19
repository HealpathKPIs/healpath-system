# Sprint 45 - Executive Export Center Rewrite

**Date:** 2026-07-17  
**Objective:** Replace the unstable Executive Export implementation with a single deterministic export system for executive acute dashboards only.  
**Result:** Rewritten. Chronic pages remain excluded. The export code now fails fast instead of producing skipped dashboards or blank captures.

## Section-based pagination (final architecture)

The long-screenshot-sliced-at-fixed-heights approach was removed entirely. PDFs are now built **from dashboard sections** (`lib/export/sections.ts` + `lib/export/pdfChrome.ts`):

- **Sections come from DOM boundaries, not image heights** — the stable dashboard root's top-level children are the sections; small lead-in chrome (page header, filter bar) rides with the section that follows it.
- **Every section starts at the top of a new PDF page.**
- Each section is captured as its own canvas, preserving its internal grid layout (KPI rows, chart pairs) exactly as rendered.
- A section taller than one page is divided **only at DOM-derived safe cut lines** that pass through no atomic component. Atomic (never split, never cropped): KPI cards, `.card` blocks (Executive Feed / Alerts / Summary), Recharts & SVG charts (`[data-export-chart]`, `.trend-chart`, `.rank-list`), tables (`table`, `.table-wrap`), page header, filters.
- **A component that doesn't fit the remaining space moves whole to the next page**; an atomic component taller than a full page is scaled down to fit one page rather than cropped.
- Identical chrome everywhere: one code path (`pdfChrome.ts`) draws the margins, header band, and `Page X of Y` footer for every page of both the current-page export and the Full Report. The Full Report renders each acute dashboard through this same section renderer inside its hidden same-origin iframe, after `waitForStableDashboard` confirms readiness (document + fonts loaded, skeletons gone, chart marks and table rows present).
- The fixed-height slicer (`placeCanvasPaginated`) was deleted. `npm run build` passes (25/25 routes).

## Scope

- Export targets are exactly the seven executive acute dashboards: Overview, Disease & Diagnosis, Pharmacy, Doctor & Specialty, Labs & Scans, Trends, Performance Matrix.
- Chronic Care, Chronic Analytics, Chronic Patient Explorer, Patient 360, imports, settings, and non-dashboard routes are excluded.
- No database, query, API, import, authentication, or dashboard business logic was changed.

## What Changed

1. **Removed the old readiness beacon path.**  
   The previous `data-export-ready` / `waitForDashboardReady` mechanism referenced a missing beacon component and could still capture after timeout. It has been removed.

2. **Added one fail-fast stability gate.**  
   `waitForStableDashboard()` waits for document load, fonts, images, no skeletons, chart/table structures, finished animations, and a quiet DOM/layout window. If those conditions do not complete, export aborts with an error instead of capturing a partial page.

3. **Rewrote Full Report capture.**  
   Every dashboard, including the current one, is rendered through the same hidden same-origin iframe path. This gives consistent dimensions and prevents different layouts between the current page and other pages.

4. **Removed skip/retry/fallback hacks.**  
   There is no cover-page-only fallback, no "dashboard skipped" placeholder, and no silent partial report. A failed dashboard fails the export, making blank or missing charts visible during QA.

5. **Standardized page chrome.**  
   PDF pages share identical margins, header, footer, generated timestamp, filters, and pagination. PNG exports now compose the captured dashboard into the same style of header/footer/margin frame instead of saving a raw screenshot.

6. **Fixed the initial reporting-month bug.**  
   When no `?month=` filter is present, export labels now show `All months` and filenames use `all-months`. The client clock no longer injects the current real month, which caused the July 2026 first-load export label bug.

## Files

- `components/export/ExportToolbar.tsx`
- `lib/export/constants.ts`
- `lib/export/types.ts`
- `lib/export/waitForStable.ts`
- `lib/export/captureElement.ts`
- `lib/export/exportPdf.ts`
- `lib/export/exportPng.ts`
- `lib/export/exportFullReport.ts`

## Verification

- Build passed after completion: `npm.cmd run build` compiled, type-checked, and generated 25/25 pages.
- Structural checks performed in code:
  - `EXPORT_DASHBOARDS` contains only the seven acute executive dashboards.
  - Full Report uses one iframe capture path for every dashboard.
  - Stability failures throw errors and do not create skipped placeholder pages.
  - Current-page PDF, PNG, and Full Report all use the same readiness gate.
