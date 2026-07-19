# Sprint 37 - Executive KPI Redesign

**Date:** 2026-07-15
**Scope:** `/chronic` KPI card presentation only. No query, API, import, or business-logic changes.

## Objective

Transform the chronic PRE vs POST KPI cards into executive-quality components with compact values, stronger hierarchy, and clearer improvement status.

## Delivered

- Added automatic executive number formatting:
  - `1,250` -> `1.3K`
  - `41,202` -> `41.2K`
  - `1,250,000` -> `1.25M`
- Updated PRE/POST comparison cards:
  - Larger compact PRE and POST values.
  - Signed compact Difference value.
  - State-colored improvement badge.
  - Improved spacing, typography, and hierarchy.
- Added badge tones:
  - Green for positive improvement.
  - Red for negative improvement.
  - Gray for flat improvement.
- Updated Operational KPI cards to use the same executive spacing and compact numeric treatment.
- Preserved existing HealPath card shell, hover lift, shadows, borders, design tokens, and responsive grid behavior.

## Verification

- `npm.cmd run build` passed.

## Notes

- Metric calculations were not changed.
- Data queries were not changed.
- API routes were not changed.
