# Phase 3 — Data Quality and Reconciliation

Phase 3 is a read-only aggregate layer. It does not parse workbooks, invoke or modify the Acute importer, change KPI SQL, alter dashboard filters, write production data, or require a database migration.

## Source and quality states

Data source state and data-quality state are separate. `LIVE`, `CACHED`, `MIXED`, and `UNAVAILABLE` describe where a result came from. `HEALTHY`, `DEGRADED`, and `UNAVAILABLE` describe the quality assessment. A reachable database is not proof that the data is correct. Any unresolved `UNKNOWN`, `WARNING`, or `CRITICAL` result keeps the quality assessment `DEGRADED`; `UNKNOWN` is never converted to `PASS`.

The Data Quality endpoint is `GET /api/admin/data-quality`. It is authenticated, admin-only, forced dynamic, and sends `Cache-Control: no-store`. It returns aggregate counts only and converts failures to a generic unavailable report instead of exposing database errors.

## Deterministic checks

All SQL uses aggregate `SELECT`/CTE queries.

| Check | Aggregate concept | Rule |
|---|---|---|
| Duplicate visit IDs | total visit rows minus distinct visit IDs | `CRITICAL` when non-zero, otherwise `PASS` |
| Duplicate patient/visit combinations | count grouped non-null patient/visit pairs having more than one row | `CRITICAL` when non-zero |
| Missing patient, doctor, specialty, date, month | conditional aggregate counts | `WARNING` when non-zero |
| Invalid dates | typed timestamp validity plus business-range assessment | `UNKNOWN`; no approved business-valid date range exists |
| Date/month inconsistencies | date `YYYY-MM` differs from valid stored `month_year` | `CRITICAL` when non-zero |
| Future-dated visits | prescription date later than database `now()` | `WARNING` when non-zero |
| Outside reporting scope | month does not match the existing `2026-*` scope | `WARNING`; outside scope is not called missing or lost |
| Null visit keys | conditional null count | `CRITICAL` when non-zero |
| Month gaps | absent calendar months between earliest and latest valid months | `WARNING` when non-zero |
| Doctor/specialty variants | raw distinct count minus lower/trim/space-normalized distinct count | `WARNING` when non-zero; no correction is made |
| Fact orphans | fact rows whose non-null visit key lacks a visit | `CRITICAL` when non-zero |
| Fact null visit keys | aggregate null-key count per fact | `WARNING` when non-zero |
| Fact null business values | blank/null disease, medication, lab test, or scan test | `WARNING` when non-zero |

## Monthly reconciliation

For every syntactically valid reporting month, the report returns actual aggregate totals for visits, dashboard-eligible visits, unique patients, doctors, specialties, diagnosis rows, drug rows, lab rows, and scan rows.

A baseline is used only when an existing `VERIFIED` governance data version points to a governance batch whose aggregate after-state contains monthly visit totals. Otherwise the month is explicitly `UNKNOWN / NO BASELINE`. Only visits can currently be compared because the existing governance version does not store monthly patient, doctor, specialty, or fact totals. No historical month is arbitrarily promoted to a baseline.

## Anomaly rules

An anomaly is an observation, not automatically an error.

- Month-over-month volume change: `UNKNOWN` until an approved significant-change threshold exists.
- Doctor or specialty disappearance: aggregate counts are shown, but status is `UNKNOWN` without an approved threshold or trusted roster baseline.
- Latest reporting month outside `2026-*`: `WARNING`; this is a scope mismatch, not proof of bad data.
- Coverage gap: `WARNING` when a month is absent inside the observed month range.
- Fact-to-visit ratios: current ratios are shown with `UNKNOWN` because no approved threshold/baseline exists.
- Increase in missing values: `UNKNOWN` without a trusted previous missing-value state and approved increase threshold.

Every issue includes severity, name, current value, baseline where available, difference, rule/explanation, and whether review is required. Phase 3 never performs automatic correction.

## Limitations

- Aggregate checks cannot identify which patient or visit caused an issue; identifiers are deliberately excluded.
- PostgreSQL timestamp types prevent syntactically invalid stored timestamps, but business-invalid date ranges require an approved rule.
- Normalization-variant counts describe possible formatting variation, not confirmed duplicates.
- Fact ratios, volume movements, and disappearances remain `UNKNOWN` until business owners approve thresholds or trusted baselines.
- Cached snapshots do not contain the complete dimensions needed for Phase 3, so Data Quality becomes `UNAVAILABLE` rather than substituting a partial cache.

## Production safety boundary

Phase 3 executes aggregate read-only queries only. It performs no `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, DDL, migration, import, re-import, workbook parsing, deduplication, normalization, or data repair. The protected Acute importer and the existing live KPI/query layer remain unchanged.
