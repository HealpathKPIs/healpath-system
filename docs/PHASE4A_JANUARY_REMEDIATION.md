# Phase 4A — January 2026 month-only remediation

Date: 2026-08-29

## Scope

One production correction was approved and executed against `healpath.visits`:

- set `month_year` to `2026-01`;
- target only rows where `prescription_date` was null, `month_year` was null,
  `month_no` was `1`, and the VisitID contained a valid `_202601DD` calendar token;
- require exactly 8,763 target rows.

No other column or table was updated. In particular, `prescription_date` remains
null for all 8,763 corrected records.

## Transaction result

The correction ran in one serializable transaction. The target rows were locked,
all pre-update assertions were checked, exactly 8,763 rows were updated, and all
post-update assertions passed before commit. An earlier attempt stopped before
the update because of a read-only fingerprint-query syntax error and rolled back.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Total visits | 77,521 | 77,521 | 0 |
| Unique visits | 77,521 | 77,521 | 0 |
| Dashboard-eligible visits | 68,758 | 77,521 | +8,763 |
| January 2026 visits | 0 | 8,763 | +8,763 |
| Dashboard-eligible patients | 23,969 | 25,225 | +1,256 |
| Null `month_year` | 8,763 | 0 | -8,763 |
| Null `prescription_date` | 8,763 | 8,763 | 0 |
| `month_no = 1` | 8,763 | 8,763 | 0 |
| Duplicate visit IDs | 0 | 0 | 0 |
| Date/month inconsistencies | 3 | 3 | 0 |

## Integrity verification

- Diagnosis, drug, lab, and scan orphan counts remained zero.
- Fact-table fingerprints were unchanged.
- Non-target visit-row fingerprints were unchanged.
- Target fingerprints excluding `month_year` were unchanged.
- The existing three date/month inconsistencies were not modified.

The Phase 2 governance tables were not present in production, so no import batch
or governance record was invented for this correction. This document is the
administrative record for the one-time remediation.
