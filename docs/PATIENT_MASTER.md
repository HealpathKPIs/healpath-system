# Patient Master

## Purpose

Patient Master is an independent backend foundation that maps a patient to a Risk Carrier. Sprint 1 keeps this module isolated so it can be tested before any analytics or dashboard integration.

## Schema

```sql
create table if not exists healpath.patient_master (
  patient_id bigint primary key,
  risk_carrier text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patient_master_risk_carrier
  on healpath.patient_master (risk_carrier);

create index if not exists idx_patient_master_updated_at
  on healpath.patient_master (updated_at desc);
```

## Upload Format

The upload workbook must contain these columns:

- `INDIVIDUAL NUMBER`
- `Risk Carrier`

All other columns are ignored. Patient IDs must be valid whole numbers in PostgreSQL `BIGINT` range. Risk Carrier values are trimmed and required.

## Import Workflow

1. Admin opens `/admin/patient-master`.
2. Admin uploads an Excel workbook.
3. The file is parsed and validated before any database write.
4. Validation blocks import for missing Patient ID, missing Risk Carrier, wrong headers, empty files, invalid Excel files, or duplicate Patient IDs inside the workbook.
5. Import performs an UPSERT into `healpath.patient_master`.
6. Existing `patient_id` rows update `risk_carrier` and `updated_at`.
7. New `patient_id` rows are inserted.
8. The page displays Total Rows, Inserted, Updated, Skipped, Errors, and Import Duration.

## Service Layer

`PatientMasterService` is available in `lib/patient-master-service.ts`.

Methods:

- `uploadPatientMaster(buffer)`
- `getPatient(patientId)`
- `getRiskCarrier(patientId)`
- `getAllRiskCarriers()`

The service delegates database access to the isolated `PatientMasterRepository`.

## Future Integration Plan

Sprint 2 can use `PatientMasterService.getRiskCarrier(patientId)` or `getAllRiskCarriers()` to add analytics integration. Sprint 1 intentionally does not add dashboard filters, joins, KPIs, Patient 360 changes, Acute integration, Chronic integration, or a Risk Carrier filter.
