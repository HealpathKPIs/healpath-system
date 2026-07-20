# Patient Explorer

## Purpose

Patient Explorer is the operational discovery layer for patient populations. It lets users filter patients across Acute, Chronic, and Patient Master data, inspect population-level KPIs, review distribution summaries, export filtered patient lists, and open Patient 360 for any selected patient.

Patient Explorer does not replace Patient 360. It is the entry point for finding patients; Patient 360 remains the detailed read-only profile.

## Architecture

- Route: `/patient-explorer`
- Navigation: placed directly above Patient 360.
- Query layer: `lib/patient-explorer.ts`
- Export route: `/api/patient-explorer/export`

The page is server-rendered and uses server-side pagination, sorting, filtering, and search. The client-side controls only update URL parameters or download prepared exports.

## Data Sources

Patient Explorer combines:

- `healpath.visits`
- `healpath.diagnosis_fact`
- `healpath.drug_fact`
- `healpath.chronic_pre`
- `healpath.chronic_post`
- `healpath.patient_master`

Risk Carrier comes only from `patient_master` through the existing Patient Master LEFT JOIN helpers.

Patient Name is available from Chronic `row_data->>'Patient Name'`. Acute-only patients show `Unknown` because the Acute source does not contain patient names.

## Filter Flow

Filters are URL-backed so future filters can plug into the same architecture. Supported filters include:

- Month
- Doctor
- Specialty
- Disease
- Risk Carrier
- Consultant
- Medication
- Active Ingredient
- Patient search by Patient ID or Patient Name

Acute filters are applied to Acute records, Chronic filters are applied to Chronic records, and source-specific filters gate the final patient population. For example, a Doctor filter requires a matching Acute record; a Consultant filter requires a matching Chronic record.

## Patient Flow

The query layer aggregates Acute and Chronic rows by Patient ID, then full-joins those aggregates into one patient list.

Each patient row includes:

- Patient ID
- Patient Name
- Risk Carrier
- Acute Visits
- Chronic Reviews
- Latest Acute Visit
- Latest Chronic Review
- Acute Status
- Chronic Status
- Combined Status

Statuses are generated automatically:

- Acute Only
- Chronic Only
- Acute + Chronic

The Open action routes to `/patient-360?patient=<patient_id>`.

## Export Flow

The export endpoint reuses the same filter parameters as the page.

Supported exports:

- Filtered patient list as CSV
- Filtered patient list as Excel-compatible `.xls`
- Executive summary export with selected filters, KPI totals, and top rankings

Exports include only the currently filtered population. The patient list export includes Patient ID, Patient Name, Risk Carrier, Acute Visits, Chronic Reviews, Latest Visit, Latest Review, and Status.

## Relationship With Patient 360

Patient Explorer never duplicates Patient 360 detail logic. It aggregates and discovers patients only. Patient 360 remains responsible for patient-level timelines, visit detail, chronic review detail, medication history, issue catalog, and detailed profile rendering.
