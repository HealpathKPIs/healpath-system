# HealPath — Production Data Import Report

**Date:** 2026-07-04
**Source workbook:** `HealPath_BI_Starter.xlsx`
**Target:** Supabase Postgres, schema `healpath` (via Session Pooler, direct `pg`)
**Result:** ✅ Imported and validated. All tables reconcile to source; foreign-key integrity clean; no NULL `visit_id`.
**Live mode:** ❌ **Not activated** — the UI still runs on the bundled 2026 snapshot. This sprint only populates and verifies the database.

---

## Connection / environment

| Item | Detail |
|---|---|
| Method | Direct PostgreSQL (`pg` driver), single transaction |
| Endpoint | Supabase **Session Pooler** (`aws-0-eu-west-1.pooler.supabase.com:5432`) |
| TLS | **Verified** against Supabase CA (`certs/prod-ca-2021.crt`, `ssl:{ ca }`, `rejectUnauthorized` on) — SSL never disabled |
| Schema access | `healpath` exposed in API settings + `service_role` grants (done in dashboard) |
| Loader | `scripts/pg-import.mjs` (additive; replicates `scripts/import.ts` cleaning rules exactly) |

### Configuration changes required to run the import (nothing in UI/CSS/pages/APIs)
- Installed dev dependencies **`dotenv`** (already imported by `scripts/import.ts` but not installed) and **`pg`** (direct Postgres driver).
- Added Supabase CA cert at `certs/prod-ca-2021.crt`.
- Added `scripts/pg-import.mjs` (direct-`pg` loader + validation).
- `scripts/import.ts` was **not** modified.

---

## Imported tables & row counts (reconciled to workbook)

| Table | Workbook rows | Skipped (orphan) | Loaded (DB `COUNT(*)`) | `COUNT(DISTINCT visit_id)` | NULL `visit_id` | Reconciles |
|---|---:|---:|---:|---:|---:|:--:|
| `visits` | 86,329 | 0 | **86,329** | 86,329 | 0 | ✅ |
| `diagnosis_fact` | 116,808 | 6 | **116,802** | 86,307 | 0 | ✅ |
| `drug_fact` | 207,136 | 3 | **207,133** | 65,186 | 0 | ✅ |
| `lab_fact` | 68,355 | 10 | **68,345** | 19,572 | 0 | ✅ |
| `scan_fact` | 10,014 | 3 | **10,011** | 8,384 | 0 | ✅ |
| **Total** | **488,642** | **22** | **488,620** | — | 0 | ✅ |

`Loaded = Workbook − Skipped` for every table. `visits.visit_id` is distinct = row count (primary key). Fact `distinct visit_id` < row count is expected (multiple facts per visit).

---

## Failed / skipped rows

**22 fact rows skipped** (6 distinct VisitIDs). These were **not** load failures — they were withheld deliberately because the DB enforces `fact.visit_id → visits.visit_id` and these VisitIDs have **no parent visit** in the source `Visit` sheet. Skipped per instruction; **no parent rows were fabricated**.

| Fact table | Skipped |
|---|---:|
| `diagnosis_fact` | 6 |
| `drug_fact` | 3 |
| `lab_fact` | 10 |
| `scan_fact` | 3 |

The 6 distinct VisitIDs:
```
6362048202606010026Heal Path Polyclinic (Chronic)
6362122202606010039Heal Path Polyclinic (Chronic)
6362155202606010049Heal Path Polyclinic (Chronic)
6185185_202605010054_Heal Path Polyclinic (Telehealth)
```

---

## Data-quality issues

1. **Referential gap in the source extract (root cause of the 22 skips).** The 4 patient numbers behind these VisitIDs (`6362048`, `6362122`, `6362155`, `6185185`) have **0 rows** in the `Visit` sheet. Proven no-match under every rule: exact `cleanId`, raw (no cleaning), underscore/space-insensitive, and digits-only core. **This is not corruption of the ID and not a cleaning/transformation artifact** — the parent visits were simply never included in the `Visit` extract.
   - The clinic suffix itself is a **legitimate business identifier**: `Heal Path Polyclinic (Chronic)` appears as `Practitioner Name` on 643 visits and `(Telehealth)` on 1,122 visits.
   - Secondary quirk: 3 of the 6 IDs are also missing their `_` delimiters (e.g. `6362048202606010026...`), but reconstructing the underscores still finds no matching visit — so the missing delimiters are not the cause.
   - **Remediation to reach 100%:** a corrected extract whose `Visit` sheet includes these 6 VisitIDs (or fact VisitIDs corrected to existing visits). `scripts/pg-import.mjs` will then load all 488,642 rows with zero skips.
2. **Whitespace in VisitID** — handled by the cleaning rule (`trim` + collapse internal whitespace), identical to `scripts/import.ts`.
3. **Corrupt `MonthYear`/date block (year 1970)** — handled per `import.ts`: `month_year` derived from reliable `Year`+`MonthName` (folded to 2026 where `Year < 2000`), and `prescription_date` nulled for those rows. `prescription_date` (timestamptz) parsed from Excel date serials via `cellDates`.

---

## Foreign-key validation

Run after load — orphan fact rows referencing a missing visit (must be 0):

| Fact table | Orphans (post-load) |
|---|---:|
| `diagnosis_fact` | **0** |
| `drug_fact` | **0** |
| `lab_fact` | **0** |
| `scan_fact` | **0** |

Query used per table:
```sql
select count(*) from healpath.<fact> f
left join healpath.visits v on v.visit_id = f.visit_id
where v.visit_id is null;
```
All fact `visit_id` values resolve to a `visits` row. The DB-level FK constraint is satisfied and enforced.

---

## Verification SQL performed

- `select count(*)` — every table (row counts above).
- `select count(distinct visit_id)` — every table (distinct column above).
- Foreign-key integrity — anti-join per fact table (all 0).
- NULL `visit_id` — `select count(*) ... where visit_id is null` — all 0.

---

## Import duration

**≈ 169.6 s** (≈ 2m 50s) for 488,620 rows in a single transaction (visits first, then the four fact tables, chunked 1,000 rows/insert) — commit only after all tables loaded, so a failure would have rolled back cleanly.

---

## Summary

- ✅ 488,620 of 488,642 source rows imported; the 22 unimported rows are documented source referential gaps, skipped by decision (not fabricated).
- ✅ Counts reconcile to the workbook for every table.
- ✅ FK integrity clean (0 orphans), 0 NULL `visit_id`.
- ✅ TLS verified end-to-end; no SSL weakening.
- ⏸️ UI **not** switched to live Supabase — dashboard still serves the bundled snapshot, as scoped.
