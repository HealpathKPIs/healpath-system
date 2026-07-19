# Business Calendar Persistence

**Date:** 2026-07-14
**Objective:** Stop hardcoding the chronic week→month mapping. Make it a single reusable **data** source (a DB table), so the import resolves the uploaded Week through it, every row stores the resolved calendar fields, and adding weeks 29, 30, 31 … requires **only extending the calendar data — no code changes**. Dashboard filters key on **Period** ("Jun 2026"), not raw week numbers.

**Result:** ✅ Delivered and verified end-to-end against Postgres, including a live "add week 29 with no code change" test. Build clean (22/22).

---

## Single source of truth: `healpath.chronic_calendar`

New table (created + seeded idempotently by `/api/chronic/import`; no existing calendar table was present):

| Column | Notes |
|---|---|
| `week` | integer **primary key** |
| `month_name` | e.g. "May" |
| `year` | e.g. 2026 |
| `month_order` | chronological order (Dec 2025 = 1 … Jun 2026 = 7; Jul 2026 = 8 …) |
| `period` | user-facing label, e.g. "Jun 2026" |

Seeded with weeks **1–28** (Dec 2025 → Jun 2026, four weeks per month) via `create table if not exists` + `insert … on conflict (week) do nothing` — safe to run repeatedly, and it **never overwrites** rows added later. Extending the calendar (weeks 29+) is a pure data operation.

## Changes

- **`lib/chronic-calendar.ts`** — reworked from hardcoded constants into a **calendar-agnostic pure helper**: every lookup (`chronicEntryForWeek`, `chronicWeeksForPeriod`, `chronicPeriodsForWeeks`, `chronicDetectedPeriodsLabel`, `chronicMissingWeeks`, …) takes a `calendar` array. It also exports `CHRONIC_CALENDAR_SEED` (the bootstrap 1–28 rows, used to seed the table and as an offline fallback) and `chronicYm`/`chronicPeriodLabel`. Shared by the query layer, the import route, and the client preview — the mapping logic exists in exactly one place.
- **`app/api/chronic/import/route.ts`**
  - `ensureCalendar()` creates + seeds the table; `loadCalendar()` reads it.
  - Import now **resolves every row's Week through the DB calendar** (`resolveCalendar`) and stores `month_name`, `year`, `period`, `month_order` (+ canonical `month` YYYY-MM). Additive columns via `alter table … add column if not exists`.
  - A week not in the calendar is a clear error ("Add it to healpath.chronic_calendar."). Summary reports **Periods Found / Weeks Found (range) / Missing Weeks** (informational).
  - New `GET /api/chronic/import` returns the calendar so the client preview is DB-driven (seed fallback).
- **`lib/queries.ts`** — `getChronicCalendar()` reads the table (seed fallback). `getChronicOverview` re-keyed from Month to **Period**: it maps the selected period → its week list via the calendar and filters on that; Period options are the periods present in the data, ordered chronologically; trend points carry the `period` label.
- **`app/chronic/page.tsx`** — the filter is now **Period** (`data.options.periods`); trend x-axis/tooltip use the period.
- **`app/chronic/import/page.tsx`** — fetches the calendar via `GET` (seed fallback), shows **Detected Periods** in the preview and **Periods Found / Weeks Found / Missing Weeks** in the import summary.

No page redesign, no DB redesign (only a new additive table + additive columns), reused the existing import pipeline and components.

## Verification (build once, verify once)

**Build:** ✅ `npm run build` EXIT 0, 22/22 routes.

**Calendar table:** `GET /api/chronic/import` created + seeded it → 28 rows; week 21 → "May 2026", week 28 → "Jun 2026".

**Import resolves through the calendar & stores all fields** (weeks 21, 22, 25 imported, then removed):
- Response: 6 rows, `periods ["May 2026","Jun 2026"]`, `weekRange "21–25"`, `missingWeeks [23,24,26,27,28]`.
- Stored per row: week 21/22 → `month 2026-05, month_name May, year 2026, month_order 6, period "May 2026"`; week 25 → `2026-06, June, 7, "Jun 2026"`.

**No code change for new weeks (the key requirement):**
- Inserted **one row** `(29, July, 2026, 8, "Jul 2026")` into `chronic_calendar`.
- Imported a week-29 workbook → resolved to **`periods ["Jul 2026"]`**, stored `month_name July, year 2026, month_order 8, period "Jul 2026"` — **no code was changed**.

**Dashboard uses Period:**
- Period options: `["May 2026","Jun 2026","Jul 2026"]` (the new July period appeared automatically, ordered).
- `period="Jul 2026"` → weeks `["29"]`; `period="May 2026"` → weeks `["21","22"]`.

**Cleanup:** all test rows (4 pre + 4 post), both batches, and the test week-29 calendar row deleted; `chronic_calendar` back to its 28-row seed; 0 test rows remain.

## Notes
- A few stale ISO-week rows (`2026-W32`) predate the chronic-calendar work; they don't resolve to any calendar week and are gracefully excluded from Period options.
- Duplicate protection (Week + Patient ID + Medication Name) and multi-week uploads are unchanged from Sprint 33.5.
- The seed lives in code only to bootstrap/repair the table and as an offline fallback; the DB table is authoritative at runtime, so operational calendar changes are data-only.
