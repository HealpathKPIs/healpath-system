# Sprint 33.5 — Chronic Calendar Intelligence

**Date:** 2026-07-13
**Objective:** Stop exposing Week numbers as the Chronic timeline. Business users think in **Months**; Week is only an internal storage field (integers 1–28, four weeks per month, December 2025 → June 2026). Support a partial calendar (some June weeks may not exist yet) without treating gaps as errors.
**Result:** ✅ Month is the primary timeline everywhere (filter, preview, import summary, trend labels). Week↔month logic lives in exactly one reusable helper. Build clean; import + dashboard filtering verified end-to-end against Postgres.

---

## The one reusable mapping helper

**`lib/chronic-calendar.ts`** (new) — a **pure module with no server dependencies**, so the query layer (`lib/queries.ts`), the import API route, and the **client** import preview all import the same logic (the client can't import `lib/queries` because it pulls in `pg`). It encodes the business calendar and exposes:

| Function | Purpose |
|---|---|
| `CHRONIC_CALENDAR` / `CHRONIC_MONTH_NAMES` | The ordered months with their `{ order, name, ym, weeks }` |
| `chronicWeekNumber(week)` | Parse `21` / `"21"` / `"Week 21"` → 1..28, else `null` |
| `chronicMonthForWeek(week)` | Week → `{ order, name, ym }` (e.g. 21 → May, order 6, 2026-05) |
| `chronicWeeksForMonth(name)` | `"May"` → `[21,22,23,24]` |
| `chronicMonthsForWeeks(weeks)` | Ordered months present in a week set |
| `chronicDetectedMonthsLabel(weeks)` | `"May"` \| `"December → June"` \| comma list |
| `chronicWeekRangeLabel(weeks)` | `"1–27"` \| `"21"` |
| `chronicMissingWeeks(weeks)` | Absent weeks within covered months (informational) |

Calendar: Dec 1-4 · Jan 5-8 · Feb 9-12 · Mar 13-16 · Apr 17-20 · May 21-24 · Jun 25-28. Nothing assumes all weeks exist.

## Changes (5 files, 1 new)

- **`lib/chronic-calendar.ts`** — new helper (above).
- **`lib/queries.ts`** — `getChronicOverview` now maps the selected **Month name → week list** via the helper and filters rows on that (`$6::text[]`); a legacy `YYYY-MM` value still matches the stored `month` column as a fallback. Month **options** are calendar month names derived from the weeks present (ordered Dec→Jun). Trend points carry a `monthLabel`; summary text no longer says "previous week".
- **`app/api/chronic/import/route.ts`** — derives `month`/`month_name`/`month_order` from the week via the helper (replaces the old ISO `YYYY-W##` parsing); stores them per row (additive `alter table … add column if not exists month_name/month_order`); allows **multi-week** uploads; returns **Months Found**, **Weeks Found** (range), **Missing Weeks**.
- **`app/chronic/page.tsx`** — the **Week filter is removed**; the **Month** filter uses calendar month names; the trend x-axis + tooltip label by **month**; the KPI delta pill dropped the "WoW" wording.
- **`app/chronic/import/page.tsx`** — preview shows **Detected Months** instead of "Multiple weeks"; the import summary shows **Months Found / Weeks Found / Missing Weeks** (missing weeks rendered as an *informational* note, never an error).

**Constraints honored:** no page redesign, no database redesign (only additive derived columns), no new APIs, reused existing components/pipeline. `getChronicOverview` return shape only gained an additive `trends[].monthLabel`.

---

## Verification (build once, verify once)

**Build:** ✅ `npm run build` EXIT 0, "Compiled successfully", 22/22 routes.

**Helper math** (unit check): 21–24 → May; `chronicWeeksForMonth('May')` → [21,22,23,24]; weeks {1..25, 27} → detected `December → June`, range `1–27`, missing `[26, 28]`; `"Week 21"` → May; invalid week 99 → null.

**Import — preview mode** (no DB write), synthetic Pre/Post with integer weeks 21–25, 27:
`months: ["May","June"]`, `weekRange: "21–27"`, `missingWeeks: [26,28]`, no errors — integer weeks now parse (the old `YYYY-W##` requirement is gone).

**Import — real round-trip** (weeks 21, 22, 25; then cleaned up):
- Response: 6 rows, 3 patients, `months ["May","June"]`, `weekRange "21–25"`, `missingWeeks [23,24,26,27,28]`.
- Stored columns confirmed: week 21/22 → `month 2026-05, month_name May, month_order 6`; week 25 → `2026-06, June, 7`.

**Dashboard month filter** (`getChronicOverview` against Postgres):
- No filter → Month options `["May","June"]` (the stale `2026-W32` test row is correctly excluded — it doesn't map to 1–28).
- `month=May` → trend weeks `["21","22"]` only (excludes June's 25 and the W32 row), month label `May`.
- `month=June` → trend weeks `["25"]`.

**Cleanup:** all test rows + batch deleted (0 remaining). No leftover data.

## Notes
- A few stale ISO-week test rows (`2026-W32`, 3 rows) predate this sprint. They don't fit the 1–28 business calendar, so they're gracefully excluded from Month options and fall back to their stored `YYYY-MM` label in the trend. They were left untouched (pre-existing data, out of scope to delete); real business imports use integer weeks and are handled exactly per spec.
- Multi-week uploads are now allowed (needed for the "Weeks 1–27" summary case); duplicate protection is unchanged (Week + Patient ID + Medication Name).
