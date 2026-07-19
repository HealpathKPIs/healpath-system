# Sprint 38 - Patient 360 Report

## Summary

Created a new read-only `/patient-360` page that combines acute and chronic patient history behind exact Patient ID search.

## Scope Delivered

- Added sidebar navigation item `Patient 360` between `Chronic Care` and `Performance Matrix`.
- Added `/patient-360` server page with Patient ID Search and empty-state handling.
- Added `Patient360Client` for tabs and expandable rows only; data fetching and aggregation stay server-side.
- Added `getPatient360` in `lib/queries.ts` as the single Patient 360 query-layer entry point, implemented with multiple small parameterized queries.
- Added Patient 360 CSS in `app/globals.css` using existing HealPath tokens.

## Data Sources

- Acute: `healpath.visits`, `healpath.drug_fact`, `healpath.diagnosis_fact`, `healpath.lab_fact`, `healpath.scan_fact`.
- Chronic: `healpath.chronic_pre`, `healpath.chronic_post`.
- Join behavior: Patient search uses exact `patient_id`; acute child facts join through `visit_id`.

## Page Behavior

- Summary cards: Patient ID, first/latest acute visit, acute visits, chronic reviews, doctors seen, diagnoses, medications, labs, scans.
- Tabs: Overview, Timeline, Acute, Chronic, Medication History, Issues.
- Timeline merges acute visits and chronic PRE/POST reviews into one ascending sequence.
- Acute rows expand to diagnoses, medications, labs, and scans.
- Chronic rows expand to recommendations and issues.
- Medication History aggregates acute medications by medication and active ingredient.
- Issues tab renders every configured chronic issue category with PRE, POST, Difference, and Improvement %.

## Verification

- Existing patient checked: `52017902`.
- Missing patient checked: `NO_SUCH_PATIENT_360`.
- Direct query verification confirmed the existing patient loaded summary, acute rows, chronic rows, merged timeline, and fixed issue catalog.
- Browser verification confirmed:
  - `/patient-360?patient=52017902` renders Patient Summary.
  - Timeline contains both acute and chronic events.
  - Acute expandable rows open.
  - Chronic expandable rows open.
  - `/patient-360?patient=NO_SUCH_PATIENT_360` renders the empty state.
- Build: `npm run build` passed.

## Non-Changes

- No Import changes.
- No Parser changes.
- No Authentication changes.
- No existing dashboard behavior changes.
- No API route changes.
- No database schema changes.
