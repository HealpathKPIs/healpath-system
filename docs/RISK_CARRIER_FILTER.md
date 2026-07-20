# Risk Carrier Filter

## Purpose

The Risk Carrier filter exposes `healpath.patient_master.risk_carrier` as a global dashboard filter. It builds on the Patient Master infrastructure and integration layer, allowing Acute, Chronic, and patient-level backend data to be scoped by carrier without changing the Patient Master schema.

## Filter Architecture

- The shared dashboard filter bar includes `riskCarrier` as a URL-backed global filter.
- Risk Carrier options are loaded from `healpath.patient_master`, not from `visits`, `chronic_pre`, or `chronic_post`.
- Option loading trims values, removes null and blank entries, removes duplicates, and sorts alphabetically.
- `All` is represented by an empty `riskCarrier` URL parameter and does not filter rows.
- Page navigation preserves `riskCarrier` alongside the existing dashboard filter parameters.

## Data Flow

1. `PatientMasterRepository.getAllRiskCarriers()` reads distinct carrier values from `healpath.patient_master`.
2. Server components pass those options to the existing filter UI.
3. `resolveFilters()` maps the `riskCarrier` URL parameter into the shared `Filters` object.
4. Acute queries reuse the existing Patient Master LEFT JOIN and add `pm.risk_carrier = selectedRiskCarrier` only when a carrier is selected.
5. Chronic queries reuse the existing PRE/POST Patient Master LEFT JOINs and filter the joined `risk_carrier` column.

## Backend Dependency

Sprint 3 depends on Sprint 2 joins:

- Acute: `healpath.visits.patient_id = healpath.patient_master.patient_id`
- Chronic: `cast(nullif(btrim(row_data->>'INDIVIDUAL NUMBER'), '') as bigint) = healpath.patient_master.patient_id`

All joins remain `LEFT JOIN`s. Patients without Patient Master rows remain visible when `All` is selected. When a specific Risk Carrier is selected, only matching Patient Master rows are included.

## Supported Pages

- Overview
- Disease & Diagnosis
- Pharmacy
- Doctor & Specialty
- Labs & Scans
- Trends
- Chronic Care
- Chronic Intelligence Center
- Patient 360
- Performance Matrix

Patient 360 keeps search behavior unchanged. Risk Carrier is displayed as patient information and shows `Unknown` when no Patient Master match exists.

## Future Extension

The same Patient Master filter architecture can be extended later for:

- TPA
- Employer
- Corporate

Those dimensions should reuse the shared URL-backed filter pattern, Patient Master repository access, and backend join helpers introduced for Risk Carrier.
