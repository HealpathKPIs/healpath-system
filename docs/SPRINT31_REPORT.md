# Sprint 31 Report - Chronic Import Center

Date: 2026-07-13

## Scope

- Added `/chronic/import` inside the existing HealPath BI Next.js app.
- Reused the existing Import Center visual style: dashed drop zone, card layout, validation panel, preview cards, and disabled import action.
- Implemented client-side Excel reading only for `Pre` and `Post` sheets.
- Added validation for:
  - Pre sheet found
  - Post sheet found
  - Required columns found
  - Week detected
  - Ready to import
- Added Pre and Post previews for Rows, Patients, Week, Recommendation Count, Issue Count, and Medication Count.
- Kept the import button disabled with: "Backend connection will be enabled in Sprint 32."

## Guardrails

- No Supabase connection.
- No SQL.
- No backend APIs.
- No upload.
- No database writes.
- No redesign.

## Files

- `app/chronic/import/page.tsx`
- `PROJECT_CONTEXT.md`
- `docs/SPRINT31_REPORT.md`

## Verification

- Build once: passed (`npm.cmd run build`).
- Upload/preview/validation: passed with a temporary valid workbook containing `Pre` and `Post` sheets.
- Invalid validation: passed with a temporary workbook missing `Post` and required columns.
- Import button: verified disabled with the Sprint 32 backend message.
