# HealPath App Router Architecture

## Scope

This report analyzes the `app/` directory only. To understand shared layout and navigation imports, the analysis also followed `components/Nav.tsx`, `components/PageHead.tsx`, and `components/FilterBar.tsx`. No application code was changed.

## App Router Map

| Route | File | Type |
|---|---|---|
| `/` | `app/page.tsx` | Server page |
| `/diseases` | `app/diseases/page.tsx` | Server page |
| `/pharmacy` | `app/pharmacy/page.tsx` | Server page |
| `/doctors` | `app/doctors/page.tsx` | Server page |
| `/diagnostics` | `app/diagnostics/page.tsx` | Server page |
| `/trends` | `app/trends/page.tsx` | Server page |
| `/login` | `app/login/page.tsx` | Client page |
| `/api/kpis` | `app/api/kpis/route.ts` | API route |
| `/api/diseases` | `app/api/diseases/route.ts` | API route |
| `/api/drugs` | `app/api/drugs/route.ts` | API route |
| `/api/specialties` | `app/api/specialties/route.ts` | API route |
| `/api/diagnostics` | `app/api/diagnostics/route.ts` | API route |
| `/api/trends` | `app/api/trends/route.ts` | API route |

## Global Layout

`app/layout.tsx` defines a single root layout for every route. It imports `app/globals.css`, sets metadata for `HealPath BI`, renders a persistent `Nav`, and places all route content inside `<main className="main">`.

The global shell is a two-column dashboard layout:

- `.app` is a full-height flex container.
- `.nav` is a 220px sticky left sidebar.
- `.main` is the content region with dashboard padding and a max width.
- On screens below 860px, the sidebar is hidden and the main padding is reduced.

There are no route groups, nested layouts, loading states, error boundaries, not-found pages, or per-section layouts in `app/`.

## Navigation

Navigation is implemented by `components/Nav.tsx`, imported by the root layout. It is a client component using `usePathname()` to mark the current link active.

Navigation links:

- `/` - Overview
- `/diseases` - Disease & Diagnosis
- `/pharmacy` - Pharmacy
- `/doctors` - Doctor & Specialty
- `/diagnostics` - Labs & Scans
- `/trends` - Trends

There is no `/login` link, no logout control, no collapsed/mobile navigation replacement when the sidebar is hidden, and no permission-aware navigation.

## Shared Page Header And Filters

Most dashboard pages render `PageHead`, which displays the page title and, by default, a global filter bar.

`PageHead` renders `FilterBar` inside `Suspense`. `FilterBar` is a client component that reads and updates the current URL query string with:

- `month`
- `specialty`

Filter changes call `router.push()` with the same pathname and updated query parameters. Pages then read `searchParams` and pass the values into server-side query helpers. This means filtering is URL-addressable and server-rendered, but there is no client-side loading indicator beyond the basic Suspense fallback.

## Login Flow

`/login` is a client component with local password input state. Clicking `Sign in` sets `document.cookie = 'hp_auth=1; path=/'` and redirects to `/`.

Current behavior observed from `app/`:

- The typed password is not validated in the page.
- No API route is called for login.
- No server action is used.
- No secure, HTTP-only, expiring, or signed session cookie is issued by this page.
- No route protection is visible inside `app/`.
- The root layout still renders the dashboard sidebar around `/login`.

If auth enforcement exists, it is outside the inspected `app/` scope. Within `app/`, the login flow is a placeholder-style client cookie setter.

## Pages

### Overview

Route: `/`

File: `app/page.tsx`

Purpose: Executive landing dashboard with top-level operational KPIs and high-level trend/ranking views.

Main UI sections:

- Page header with global month and specialty filters.
- KPI row: Visits, Patients, Doctors, Meds / visit, Labs / visit.
- Two-column ranking section: Top 5 disease blocks and Top 5 active ingredients.
- Monthly trend card: Average per visit by month.

API endpoints consumed:

- None via HTTP from the page.
- The server page calls query helpers directly: `getKpis`, `getDiseases`, `getDrugs`, `getTrends`.

Components rendered:

- `PageHead`
- `KpiCard`
- `BarRank`
- `TrendLine`

Current implementation status:

- Implemented as an async server-rendered dashboard page.
- Supports URL-driven `month` and `specialty` filters.
- Uses parallel data loading with `Promise.all`.
- Includes KPI values, rank charts, and trend visualization.

Missing functionality compared to a production BI dashboard:

- No explicit loading or error state for failed data queries.
- No data freshness indicator or last-refresh timestamp.
- No export/download action for KPI or chart data.
- No drill-through from KPI/rank items into underlying records.
- No configurable metric definitions, comparison period selector, or saved views.

### Disease & Diagnosis

Route: `/diseases`

File: `app/diseases/page.tsx`

Purpose: Disease analytics page focused on ICD block ranking, block share, and diagnosis drill-down.

Main UI sections:

- Page header with global month and specialty filters.
- Two-column section: Diagnoses by ICD block and ICD block share.
- Diagnosis drill-down table with search by ICD description.

API endpoints consumed:

- None via HTTP from the page.
- The server page calls query helpers directly: `getDiseases`, `getDiseaseDescriptions`.

Components rendered:

- `PageHead`
- `BarRank`
- `Donut`
- `DataTable`

Current implementation status:

- Implemented as an async server-rendered analytics page.
- Displays top ICD blocks, a donut share view, and a searchable diagnosis table.
- Supports URL-driven `month` and `specialty` filters.

Missing functionality compared to a production BI dashboard:

- No hierarchical drill path from block to diagnosis to patient/visit-level detail.
- No chart cross-filtering between donut, rank list, and table.
- No export for diagnosis table.
- No pagination or virtualized table handling visible from the page.
- No clinical coding quality flags, unmapped-code indicators, or data validation summaries.

### Pharmacy

Route: `/pharmacy`

File: `app/pharmacy/page.tsx`

Purpose: Medication utilization page focused on average medicines per visit and drug rankings.

Main UI sections:

- Page header with global month and specialty filters.
- KPI row: Meds / visit with month-over-month delta.
- Two-column ranking section: Top active ingredients and Top brands.

API endpoints consumed:

- None via HTTP from the page.
- The server page calls query helpers directly: `getKpis`, `getDrugs`, `getTrends`.

Components rendered:

- `PageHead`
- `KpiCard`
- `BarRank`

Current implementation status:

- Implemented as an async server-rendered dashboard page.
- Supports filtered medication KPIs and rankings.
- Shows trend delta for meds per visit.

Missing functionality compared to a production BI dashboard:

- No formulary/category grouping, therapeutic class filtering, or medication search.
- No drill-through from ingredient/brand to visits, doctors, specialties, or diagnoses.
- No prescription safety, duplicate therapy, or outlier analysis.
- No export for ranked medication data.
- No configurable top-N, date range, or comparison period controls.

### Doctor & Specialty

Route: `/doctors`

File: `app/doctors/page.tsx`

Purpose: Provider and specialty utilization page for ranking specialties and comparing doctor-level metrics.

Main UI sections:

- Page header with global month and specialty filters.
- Visits by specialty rank chart.
- Doctor matrix table: doctor, specialty, visits, meds per visit, labs per visit.

API endpoints consumed:

- None via HTTP from the page.
- The server page calls query helper `getSpecialties`.

Components rendered:

- `PageHead`
- `BarRank`
- `DataTable`

Current implementation status:

- Implemented as an async server-rendered page.
- Supports specialty ranking and a searchable doctor matrix.
- Supports URL-driven `month` and `specialty` filters.

Missing functionality compared to a production BI dashboard:

- No provider profile drill-down.
- No benchmark comparisons against specialty averages or peer groups.
- No outlier detection, thresholds, or conditional formatting visible at page level.
- No provider-level trend over time.
- No export, row actions, or configurable table columns.

### Labs & Scans

Route: `/diagnostics`

File: `app/diagnostics/page.tsx`

Purpose: Diagnostics utilization page for labs, scans, and their average-per-visit KPIs.

Main UI sections:

- Page header with global month and specialty filters.
- KPI row: Labs / visit and Scans / visit, each with month-over-month delta.
- Two-column ranking section: Top lab tests and Top scans.

API endpoints consumed:

- None via HTTP from the page.
- The server page calls query helpers directly: `getKpis`, `getDiagnostics`, `getTrends`.

Components rendered:

- `PageHead`
- `KpiCard`
- `BarRank`

Current implementation status:

- Implemented as an async server-rendered dashboard page.
- Supports filtered diagnostics KPIs and test rankings.
- Shows trend deltas for labs and scans.

Missing functionality compared to a production BI dashboard:

- No grouping by test category, modality, or order type.
- No drill-through from test/scan to ordering doctor, specialty, diagnosis, or visit context.
- No appropriateness, duplicate order, or utilization threshold analysis.
- No export for ranked diagnostics data.
- No comparison controls beyond current URL filters.

### Trends

Route: `/trends`

File: `app/trends/page.tsx`

Purpose: Trend-focused page showing average-per-visit lines and current deltas versus the previous month.

Main UI sections:

- Page header with global filters.
- Trend chart: Average per visit by month.
- Delta strip: Meds, Labs, Scans versus previous month.

API endpoints consumed:

- None via HTTP from the page.
- The server page calls query helper `getTrends`.

Components rendered:

- `PageHead`
- `TrendLine`
- `TrendArrow`

Current implementation status:

- Implemented as an async server-rendered trend page.
- Reads `specialty` from URL search params.
- Renders multi-metric trend visualization and three delta indicators.

Missing functionality compared to a production BI dashboard:

- The page only passes `specialty` to `getTrends`; `month` filtering from the shared header is not consumed by this page.
- No selectable date range, granularity, baseline, or comparison period.
- No annotations for data refreshes, unusual periods, or operational events.
- No metric toggles or chart interaction controls.
- No export of trend series.

### Login

Route: `/login`

File: `app/login/page.tsx`

Purpose: Shared-access login screen for entering a dashboard password.

Main UI sections:

- Centered login box.
- HealPath brand.
- Password input.
- Sign-in button.

API endpoints consumed:

- None.

Components rendered:

- No imported app components.
- Uses local JSX and global CSS classes.

Current implementation status:

- Implemented as a client component.
- Maintains password input state.
- On sign-in, sets `hp_auth=1` client-side and redirects to `/`.

Missing functionality compared to a production BI dashboard:

- No password validation.
- No server-side login endpoint or server action.
- No secure session handling.
- No logout.
- No visible route guarding in `app/`.
- Login route still sits inside the global dashboard layout/sidebar.
- No failed-login state, rate limiting, audit logging, or accessibility enhancements beyond native input/button behavior.

## API Route Handlers

All API route handlers are `GET` endpoints under `app/api`. They read query parameters with `req.nextUrl.searchParams`, call server-side query helpers, and return JSON with `NextResponse.json()`.

### `/api/kpis`

File: `app/api/kpis/route.ts`

Query parameters:

- `month`
- `specialty`

Behavior:

- Calls `getKpis({ month, specialty })`.
- Returns the KPI object as JSON.

Current status:

- Implemented.
- Not consumed by the inspected pages.

Production gaps:

- No input validation.
- No error handling response shape.
- No auth check visible inside handler.
- No cache-control or revalidation policy visible.

### `/api/diseases`

File: `app/api/diseases/route.ts`

Query parameters:

- `month`
- `specialty`
- `limit`, defaulting to `10`

Behavior:

- Calls `getDiseases(filter, limit)` and `getDiseaseDescriptions(filter)` in parallel.
- Returns `{ blocks, descriptions }`.

Current status:

- Implemented.
- Not consumed by the inspected pages.

Production gaps:

- `limit` is coerced with `Number()` but not range-checked.
- No input validation or error handling response shape.
- No auth check visible inside handler.
- No pagination support for descriptions.

### `/api/drugs`

File: `app/api/drugs/route.ts`

Query parameters:

- `month`
- `specialty`

Behavior:

- Calls `getDrugs({ month, specialty })`.
- Returns drug ranking data as JSON.

Current status:

- Implemented.
- Not consumed by the inspected pages.

Production gaps:

- No input validation.
- No error handling response shape.
- No auth check visible inside handler.
- No configurable top-N or search parameter.

### `/api/specialties`

File: `app/api/specialties/route.ts`

Query parameters:

- `month`
- `specialty`

Behavior:

- Calls `getSpecialties({ month, specialty })`.
- Returns specialty ranking and doctor matrix data as JSON.

Current status:

- Implemented.
- Not consumed by the inspected pages.

Production gaps:

- No input validation.
- No error handling response shape.
- No auth check visible inside handler.
- No pagination, sorting, or column-selection parameters.

### `/api/diagnostics`

File: `app/api/diagnostics/route.ts`

Query parameters:

- `month`
- `specialty`

Behavior:

- Calls `getDiagnostics(filter)` and `getKpis(filter)` in parallel.
- Returns diagnostics ranking data plus `avgLabs` and `avgScans`.

Current status:

- Implemented.
- Not consumed by the inspected pages.

Production gaps:

- No input validation.
- No error handling response shape.
- No auth check visible inside handler.
- No category/modality/search parameters.

### `/api/trends`

File: `app/api/trends/route.ts`

Query parameters:

- `specialty`

Behavior:

- Calls `getTrends(specialty)`.
- Returns trend points and deltas as JSON.

Current status:

- Implemented.
- Not consumed by the inspected pages.

Production gaps:

- Does not accept `month`, date range, or granularity parameters.
- No input validation.
- No error handling response shape.
- No auth check visible inside handler.

## Cross-Cutting Architecture Observations

- The dashboard pages are mostly server components that call query helpers directly rather than consuming the local API routes.
- The API routes expose similar data surfaces, likely for future client-side consumers or external use, but there is currently no observed in-app HTTP consumption.
- Filtering is handled through URL query parameters, which is good for shareable dashboard state.
- The shared filter bar appears on the Trends page, but the Trends page only consumes `specialty`; `month` may appear in the URL without changing trend data.
- Authentication is not enforced in the inspected `app/` files.
- The root layout applies the same navigation shell to `/login` as to dashboard pages.
- There are no App Router `loading.tsx`, `error.tsx`, `not-found.tsx`, nested layouts, route groups, or metadata overrides for individual pages.

## Production BI Dashboard Gaps Summary

- Strong authentication and route protection.
- Role-based access control and permission-aware navigation.
- Standardized API validation, error handling, and auth checks.
- Data freshness and reconciliation status surfaced in the UI.
- Export/download support for tables and charts.
- Drill-through and cross-filtering between visuals.
- Loading, empty, and error states.
- Mobile navigation replacement when the sidebar is hidden.
- Saved filters, bookmarks, configurable top-N, and comparison periods.
- Observability hooks for API errors, slow queries, and dashboard usage.
