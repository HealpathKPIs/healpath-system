# Sprint 36R Report - Chronic Dashboard Refactor

## Source Reference

- Used the uploaded Chronic Power BI PDF at `C:\Users\User\Downloads\صpdf.pdf`.
- Copied it temporarily to an ASCII path for extraction because the Arabic filename was mangled by the shell/Python stdin path encoding.
- Business logic taken from the PDF:
  - PRE vs POST summary cards.
  - PRE vs POST Issues per Patient line.
  - PRE vs POST Recommendations per Patient line.
  - Fixed issue category comparison.
  - Fixed recommendation category comparison.
  - Operational KPIs for Waiting Lab, No Need For Chronic, and No Need %.

## Delivered

- Refactored `/chronic` from a generic analytics dashboard into a PRE vs POST clinical outcome dashboard.
- Preserved HealPath UI language: cards, filters, animated numbers, premium tables, line charts, skeleton-compatible layout.
- Kept filters to Period, Consultant, Patient Search, Issue, and Recommendation.

## Executive Comparison

Every KPI card now shows:

- PRE value
- POST value
- Difference (`POST - PRE`)
- Improvement % (`(PRE - POST) / PRE`)

Metrics:

- Patients
- Medications
- Issues
- Recommendations
- Average Medications / Patient
- Average Issues / Patient
- Average Recommendations / Patient

## Clinical Outcome

- Replaced generic trend widgets with PRE vs POST outcome lines.
- Added Issues per Patient with PRE line, POST line, and improvement %.
- Added Recommendations per Patient with PRE line, POST line, and improvement %.

## Fixed Catalog Comparisons

- Removed Top Issues, Top Recommendations, Biggest Movers, Pareto, correlation, treemap-style analytics, and executive feed from `/chronic`.
- Issue Comparison always renders the complete configured issue catalog, not Top N and not frequency-sorted.
- Recommendation Comparison always renders the complete fixed recommendation catalog:
  - As Is
  - To be re-evaluated
  - Monitored
  - To be stopped
  - Adjusted
  - Modified
- Issue catalog order follows the uploaded PDF order using catalog hints mapped to full labels from chronic data options, then appends any unmatched configured labels.

## Operational KPIs

- Waiting Lab
- No Need For Chronic
- No Need %

## Constraints Preserved

- No Patient Explorer.
- No matrix.
- No import changes.
- No parser changes.
- No API route changes.
- No authentication changes.
- No database/schema changes.
- No new query duplication; reused `getChronicOverview` and derived aggregates from the same fetched row set.

## Verification

- Code-level verification:
  - Issue table is rendered from `data.prePost.issueCatalog`, which is produced from the fixed issue catalog order and never from ranked popularity.
  - Recommendation table is rendered from `data.prePost.recommendationCatalog`, which is produced from the fixed Power BI recommendation order.
  - PRE/POST values are derived from phase-specific chronic rows.
  - Difference is `POST - PRE`.
  - Improvement % is `(PRE - POST) / PRE`.
- Build:
  - Ran the requested single `npm.cmd run build`.
  - The implementation compiled and type-checked.
  - Build then failed during page-data collection with an unrelated `PageNotFoundError: Cannot find module for page: /api/admin/import`.
  - The unrelated API route was not inspected or modified due to the Sprint 36R scope fence.
