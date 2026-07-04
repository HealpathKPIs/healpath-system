# Sprint 1 Report

## 1. Files Modified

- `app/globals.css`
- `app/loading.tsx`
- `app/login/page.tsx`
- `app/trends/page.tsx`
- `app/doctors/page.tsx`
- `app/diseases/page.tsx`
- `components/BarRank.tsx`
- `components/DataTable.tsx`
- `components/Donut.tsx`
- `components/FilterBar.tsx`
- `components/KpiCard.tsx`
- `components/Nav.tsx`
- `components/PageHead.tsx`
- `components/TrendArrow.tsx`
- `components/TrendLine.tsx`
- `docs/APP_ARCHITECTURE.md`
- `docs/SPRINT1_REPORT.md`

## 2. Runtime Bugs Fixed

- Fixed a Next.js App Router runtime error caused by passing formatter functions from server pages into the client `DataTable` component.
- Replaced those function props with serializable column metadata while preserving numeric display formatting.
- Cleared a stale generated `.next` dev-server cache after Next reported a missing webpack chunk.
- Verified all main dashboard routes returned HTTP 200 after the cleanup.

## 3. Remaining UI Issues

- Mobile navigation is improved and responsive, but it is still a horizontal nav strip rather than a dedicated mobile drawer or menu.
- The new rank charts are visually reliable, but they are static and do not yet provide hover tooltips or click interactions.
- The trend chart is now rendered reliably, but it is also static and does not yet support hover values, metric toggles, or zooming.
- Empty states are present, but still generic and not customized per dashboard domain.
- Login remains inside the global app shell; a production login experience may need a separate unauthenticated layout.
- Table UX is improved, but there is still no pagination, column pinning, column visibility control, or export action.

## 4. Remaining Power BI Parity Issues

- No cross-filtering between charts, KPI cards, and tables.
- No drill-through from summary visuals into detailed visit, doctor, diagnosis, medication, lab, or scan records.
- No export/download parity for tables or visuals.
- No report bookmarks, saved views, or persistent user filter presets.
- No configurable date range, comparison period, or time granularity beyond the existing URL filters.
- No advanced BI interactions such as slicer panels, visual-level filters, or tooltip detail pages.
- No data refresh status, reconciliation status, or last-updated indicator shown in the dashboard UI.
