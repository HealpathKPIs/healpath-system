# Sprint 13 - Power BI Parity Audit

**Date:** 2026-07-04
**Objective:** Audit every dashboard page against the original Power BI model and fix only high-severity parity issues.
**Result:** One high-severity filter issue was fixed. No UI, CSS, component, API route, or architecture changes were made.

---

## Scope

Audited all app pages:

| Page | Route | Main data surfaces |
|---|---|---|
| Overview | `/` | KPIs, top disease blocks, top active ingredients, trend chart |
| Disease & Diagnosis | `/diseases` | ICD block chart/donut, ICD description table |
| Pharmacy | `/pharmacy` | KPIs, top active ingredients, top brands |
| Doctor & Specialty | `/doctors` | KPIs, doctor ranking, specialty ranking, doctor matrix |
| Labs & Scans | `/diagnostics` | Labs/scans KPIs, top labs, top scans |
| Trends | `/trends` | monthly meds/labs/scans trends and deltas |

Audit dimensions: KPIs, charts, filters, tables, trend calculations, month filtering, and specialty filtering.

Reference source: `data/snapshot2026.json`, which mirrors the Power BI model for all-2026 and month slices.

---

## High-Severity Fix

### Fixed: specialty filter newline mismatch

**Severity:** High

The snapshot/model specialty list contains `Chest and Respiratory\n`, but the live database stores the specialty as `Chest and Respiratory`. Before this audit, selecting that visible filter value returned zero live KPI/chart/table data on most pages and caused `getTrends` to fall back to the all-specialty snapshot trend.

Fix:

- Added `specialtyParam()` in `lib/queries.ts`.
- All live SQL bind arrays now pass the specialty through `trim()` before binding.
- This keeps SQL parameterized and does not alter UI, CSS, routes, components, or API shapes.

Post-fix verification:

| Check | Result |
|---|---|
| `Chest and Respiratory\n` KPIs equal `Chest and Respiratory` KPIs | pass |
| disease chart filter equality | pass |
| pharmacy filter equality | pass |
| diagnostics filter equality | pass |
| doctor/specialty filter equality | pass |
| trends filter equality | pass |

The corrected all-2026 KPI result for this specialty is 4 visits, 4 patients, 2 doctors, 1 specialty, 3.25 meds/visit, 0 labs/visit, and 0.25 scans/visit.

---

## Parity Results

### All-2026

All audited all-2026 surfaces matched the Power BI model.

| Surface | Result |
|---|---|
| KPIs | match |
| Overview disease top 5 | match |
| Disease ICD block top 10 | match |
| Disease description top 15 | match |
| Pharmacy active ingredients top 15 | match |
| Pharmacy brands top 10 | match |
| Labs top 10 | match |
| Scans top 10 | match |
| Specialty ranking | match |
| Doctor matrix top 20 | match |
| Trends monthly points and deltas | match |

### Month Filtering

KPI month filters matched for every month from `2026-01` through `2026-06`.

Most Top-N month-filtered visuals matched exactly. The only remaining mismatches are tied-row ordering differences listed below.

### Specialty Filtering

Representative specialty filter checks passed after the high-severity fix.

| Specialty | Result |
|---|---|
| Internal Medicine | live filtered KPIs match known model/Sprint 7 values |
| Chest and Respiratory newline option | now maps to the live DB specialty and returns filtered data |

Internal Medicine all-2026 KPIs: 22,363 visits, 10,460 patients, 8 doctors, 1 specialty, 2.31 meds/visit, 1.21 labs/visit, 0.05 scans/visit.

### Trends

All full-window trend points matched Power BI:

| Month | Meds | Labs | Scans |
|---|---:|---:|---:|
| 2026-01 | 2.71 | 0.75 | 0.13 |
| 2026-02 | 2.58 | 0.68 | 0.11 |
| 2026-03 | 2.62 | 0.62 | 0.10 |
| 2026-04 | 2.18 | 1.08 | 0.14 |
| 2026-05 | 2.20 | 1.00 | 0.12 |
| 2026-06 | 1.89 | 0.94 | 0.13 |

Deltas matched:

| Measure | Delta |
|---|---:|
| Meds | -0.31 |
| Labs | -0.06 |
| Scans | 0.01 |

---

## Remaining Mismatches

No high-severity mismatches remain.

The remaining mismatches are low-severity tied-row ordering differences. Counts and labels are the same, but tied rows appear in a different order than Power BI for specific month-filtered Top-N visuals.

| Severity | Page | Filter | Surface | Difference |
|---|---|---|---|---|
| Low | Disease & Diagnosis | `month=2026-02` | ICD description table | `0` and `Irritable bowel syndrome without diarrhoea` both have 403; order differs |
| Low | Pharmacy | `month=2026-02` | Active ingredients chart | `PANTOPRAZOLE` and `Amoxicillin.Clavulanic acid` both have 429; order differs |
| Low | Labs & Scans | `month=2026-02` | Top scans chart | `MRI SHOULDER` and `X-Ray Cervical Spine 2 views` both have 14; order differs |
| Low | Labs & Scans | `month=2026-05` | Top scans chart | `MRI SHOULDER` and long `93307... Echocardiography...` label both have 27; order differs |
| Low | Labs & Scans | `month=2026-06` | Top labs chart | `TSH in  serum` and `Ferritin` both have 520; order differs |

These were not fixed because Sprint 13 authorized fixes only for high-severity parity issues.

---

## Notes

- The Trends page only consumes `specialty`, not `month`; this is consistent with the existing architecture notes and the Power BI snapshot trend reference, which represents the full month axis.
- `listMonths()` and `listSpecialties()` remain synchronous snapshot helpers by design.
- The bundled snapshot fallback remains intact across the data layer.
