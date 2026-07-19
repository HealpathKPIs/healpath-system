# Sprint 32 Report - Chronic Import Backend

Date: 2026-07-13

## Scope

- Connected the existing `/chronic/import` UI to a backend import route.
- Added `POST /api/chronic/import` for chronic workbook preview/import.
- Created the chronic Supabase Postgres tables if missing:
  - `healpath.chronic_pre`
  - `healpath.chronic_post`
  - `healpath.chronic_import_batches`
- Inserted all validated `Pre` rows into `healpath.chronic_pre`.
- Inserted all validated `Post` rows into `healpath.chronic_post`.
- Created one completed batch row in `healpath.chronic_import_batches`.
- Enabled the Import button after validation.

## Validation

- Rejects missing `Pre` sheet.
- Rejects missing `Post` sheet.
- Rejects missing required columns.
- Rejects missing Week values.
- Rejects missing Patient ID values.
- Rejects missing Recommendation values.
- Rejects missing Medication Name values.
- Rejects duplicate Week + Patient ID + Medication Name records before any write.

## Guardrails

- No dashboard work.
- No charts.
- No KPIs.
- No redesign.

## Files

- `app/chronic/import/page.tsx`
- `app/api/chronic/import/route.ts`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT32_REPORT.md`

## Verification

- Build once: passed (`npm.cmd run build`).
- Preview: passed for a temporary workbook with `Pre` and `Post` only.
- Real import: passed via `/api/chronic/import`.
- Supabase insertion: verified `2` `chronic_pre` rows, `1` `chronic_post` row, and `1` completed `chronic_import_batches` row for the test file.
- Duplicate protection: re-importing the same workbook returned `409` with `Duplicate records detected.`
