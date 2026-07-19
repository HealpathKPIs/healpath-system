# Sprint 33.5C Report - Shared Chronic Parser

## Scope

Removed the remaining duplicate chronic workbook parsing path by creating one shared parser for both Preview and Import.

## Changed

- Added `lib/chronic-parser.ts` as the single implementation for:
  - `normalizeHeader()`
  - `detectColumns()`
  - `validateWorkbook()`
  - `parseWorkbook()`
  - Patient ID aliases
  - Week aliases
  - Recommendation aliases
  - Issue-column detection
- Updated `/chronic/import` client preview to call `parseWorkbook()` and `validateWorkbook()` from `lib/chronic-parser.ts`.
- Updated `/api/chronic/import` server import to call the same `parseWorkbook()` from `lib/chronic-parser.ts`.
- Removed duplicated client/server header detection and workbook validation logic.
- Updated `PROJECT_CONTEXT.md`.

## Validation Contract

The Preview and Import paths now use the same parsed workbook model:

- `preview.detectedColumns`
- `preview.requiredColumns`
- `preview.errors`

If Preview detects Patient ID, Week, Recommendation, and Issue columns, the server import uses the exact same detection result instead of a separate alias table.

## Not Changed

- No database changes.
- No API redesign.
- No page redesign.
- No dashboard changes.

## Verification

- Build: passed with `npm.cmd run build`.
