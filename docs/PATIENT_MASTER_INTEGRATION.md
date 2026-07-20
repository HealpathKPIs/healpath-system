# Patient Master Integration

## Purpose

Sprint 2 makes `risk_carrier` available throughout the backend data layer without changing dashboard UI, filters, cards, charts, KPIs, Patient 360 rendering, Acute import, or Chronic import.

## Join Strategy

All integration uses `LEFT JOIN` so patients missing from `healpath.patient_master` remain in every result set. Missing carriers return `NULL`.

The Patient Master repository owns the common join snippets:

- Acute: `patient_master.patient_id = visits.patient_id`
- Chronic: `patient_master.patient_id = cast(row_data->>'INDIVIDUAL NUMBER' as bigint)`

The query layer reuses those helpers instead of duplicating join logic.

## Acute Mapping

Acute data joins through `healpath.visits`:

```sql
left join healpath.patient_master pm
  on pm.patient_id = v.patient_id::bigint
```

The join is available in backend Acute query paths for overview KPIs, diseases, drugs, labs, scans, trends, doctors, diagnostics, performance rowsets, and Patient 360 acute rows. Existing aggregate calculations continue to count visits, patients, doctors, medications, labs, scans, and diagnoses from their original source tables.

## Chronic Mapping

Chronic data joins through the patient number stored in each workbook row:

```sql
left join healpath.patient_master pm
  on pm.patient_id = cast(nullif(btrim(row_data->>'INDIVIDUAL NUMBER'), '') as bigint)
```

The join is applied to both `healpath.chronic_pre` and `healpath.chronic_post`. It does not modify `row_data`, does not update imported rows, and does not change Chronic import behavior.

## Patient 360 Mapping

When `getPatient360()` loads a patient, it fetches the patient's Risk Carrier from `PatientMasterService.getRiskCarrier(patientId)` and returns it on the backend summary as `risk_carrier`.

Patient 360 acute visits, chronic reviews, and medication-history row types also expose optional `risk_carrier` values for future use. Sprint 2 does not display those values.

## Performance Considerations

`healpath.patient_master.patient_id` is the primary key, so joins are one-to-one and indexed. Additional indexes from Sprint 1 support future carrier enumeration and import-status checks:

- `idx_patient_master_risk_carrier`
- `idx_patient_master_updated_at`

Because all joins are `LEFT JOIN`s on a primary key, they should not duplicate source rows or remove patients that are not yet in Patient Master.

## Sprint 2 Boundary

No Risk Carrier filters, UI labels, cards, charts, dashboard changes, Patient 360 display changes, Acute integration screens, or Chronic integration screens were added in this sprint.
