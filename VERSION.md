# HealPath System Version

Version: v1.2.0

## Commit Hash

Sprint 20 sync commit: `61cd279b528b8593c1e82e514794205961061841`

## Completed Sprints

- Environment recovery: resolved stale `.next` runtime rendering issue.
- Sprint 1: Initial dashboard foundation.
- Sprint 2: Application structure and supporting routes.
- Sprint 3: Premium executive design system.
- Sprints 4 and 5: Doctor and Pharmacy executive dashboards.
- Sprint 6: Production workbook import to Supabase.
- Sprint 7: Overview live data via direct Postgres.
- Sprint 8: Disease & Diagnosis live data.
- Sprint 9: Labs & Scans live data.
- Sprint 10: Pharmacy live verification.
- Sprint 11: Doctor & Specialty live data.
- Sprint 12: Trends live verification.
- Sprint 13: Power BI parity audit and high-severity filter parity fix.
- Sprint 14: `listMonths` and `listSpecialties` live via async-warmed cache.
- Sprint 15: Global Doctor filter via URL query params.
- Sprint 16: Cross-filter interaction infrastructure.
- Sprint 17: Activated URL-backed cross-filtering.
- Sprint 18A: Rich trend tooltip and Doctor synchronization.
- Sprint 18B: Doctor URL persistence regression fixes and Trend tooltip hover target.
- Sprint 19: Universal search.
- Sprint 20: Executive Insights panel and Vitamin D alert.

## Current Live Pages

- Overview (`/`)
- Disease & Diagnosis (`/diseases`)
- Pharmacy (`/pharmacy`)
- Labs & Scans (`/diagnostics`)
- Doctor & Specialty (`/doctors`)
- Trends (`/trends`)

Global filters: Month, Specialty, Doctor.

## Remaining Work

- Optional: load the 22 skipped fact rows after receiving a corrected workbook extract.
- Later cleanup: remove dead `lib/supabase.ts` and the exported `SQL` object from `lib/queries.ts` when the snapshot-retirement plan is decided.
- Known low-severity parity gap: a few month-filtered Top-N visuals have tied rows in a different order than Power BI; counts and labels match.
