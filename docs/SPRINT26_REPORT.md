# Sprint 26 — Data Import Center

**Date:** 2026-07-06
**Objective:** A simple Admin → Data Import page — **UI only** over the existing importer. No new parser, no duplicated import logic.
**Result:** ✅ `/admin/import` (in the sidebar nav) drives the exact same importer code as the CLI, via one extracted shared module. All six UI steps verified end-to-end with a real import.

---

## Single source of truth

`scripts/pg-import.mjs` is a top-level CLI script, so it cannot be imported by Next.js directly. Per the spec, **only the shared logic was extracted** into one reusable module:

- **`lib/import-core.mjs`** — the importer: `parseWorkbook()` (sheet parsing + all cleaning rules, verbatim), `loadDatabase()` (verified-TLS pooled Postgres, one transaction, visits→facts, chunked 1000, `onProgress` callback), `validateDatabase()` (COUNT / DISTINCT / NULL / FK checks).
- **`scripts/pg-import.mjs`** — now a thin CLI wrapper over the core (same usage, same orphan-skip reporting, same validation output).
- **`/api/admin/import`** — the UI's server endpoint over the same core.

**Proof of equivalence:** the extracted parser was run against the original `HealPath_BI_Starter.xlsx` and reproduced the Sprint 6 numbers exactly — visits 86,329; diagnosis 116,802; drug 207,133; lab 68,345; scan 10,011; orphan skips 6/3/10/3.

## The endpoint (additive; no existing API touched)

`POST /api/admin/import` (multipart):
- `mode=preview` → parse + clean only, returns per-table counts + skip details. **No database write.**
- `mode=import` → runs `loadDatabase` and **streams NDJSON progress** (`start` → per-chunk `progress {table, inserted, total}` → `done {loaded, durationMs}` / `error`).

## The page (`app/admin/import/page.tsx`)

Implements the six required steps: ① drop-zone ("Drop Excel Here / Browse File") → ② **✔ File Loaded** + automatic preview (parse only) → ③ **IMPORT DATA** button → ④ "Uploading…", progress bar, "Importing Visits/Drug/Diagnosis/Laboratory/Scans…" → ⑤ **✔ Import Completed Successfully** with per-table counts + duration → ⑥ **Refresh Dashboard** (full reload to `/`). The preview also warns that re-importing an already-loaded extract appends duplicate fact rows (existing importer semantics — visits are PK-deduped, facts are not).

## Files changed (5 — within the limit)
| File | Change |
|---|---|
| `lib/import-core.mjs` | **New** — extracted importer (single source of truth) |
| `scripts/pg-import.mjs` | Thin CLI wrapper over the core (behaviour preserved) |
| `app/api/admin/import/route.ts` | **New** — preview / streamed-import endpoint |
| `app/admin/import/page.tsx` | **New** — the UI |
| `components/Nav.tsx` | "Data Import" sidebar link |

One interop fix worth noting: `xlsx` is loaded via `createRequire` (CJS build) so the identical module works under both the Node CLI and the Next.js webpack bundle; parsing always goes through `XLSX.read(buffer)`.

No SQL changes, no DB redesign, no auth, no routing redesign, no existing-API changes, no new parser.

---

## Verification (once)

Build: ✅ EXIT 0, "Compiled successfully", **18/18** routes (`/admin/import` page + `/api/admin/import` route).

End-to-end with a disposable test workbook (3 visits dated **2020** — outside the 2026 reporting window, therefore invisible to every dashboard metric — plus 2 drug / 3 diagnosis (1 deliberate orphan) / 1 lab / 1 scan):

| Step | Result |
|---|---|
| ✔ File Loaded | shown after injecting the file (same code path as Browse File) |
| Preview (no DB write) | Visits 3 · Drug 2 · Diagnosis 2 · Laboratory 1 · Scans 1, + "1 source row(s) will be skipped" (the orphan) |
| Progress | "Uploading..." → "Importing Visits..." → "Importing Diagnosis..." → "Importing Laboratory..." → "Importing Scans..." with a moving progress bar |
| Completed | **✔ Import Completed Successfully** — 3/2/2/1/1, **Duration 1.7s** |
| Refresh Dashboard | click → full reload to `/` (Overview rendered) |
| DB write confirmed | `TEST_S26_%` rows present: 3/2/2/1/1 (orphan correctly excluded) |

**Cleanup & parity:** all 9 test rows deleted (0 remnants); `/api/kpis` unchanged — `77,306 / 29,128 / 61 / 19 / 2.42 / 0.84 / 0.12`. Temp files removed.

---

## Notes
- Import is **append-semantics** for fact tables (unchanged from the CLI importer). The UI surfaces this; a future sprint could add idempotency if desired.
- The page has no authentication (per rules — none exists in the app beyond the cosmetic login).
- Large workbooks upload in one request; the ~30MB starter file is fine locally, but a serverless deployment may need a body-size/duration review.
