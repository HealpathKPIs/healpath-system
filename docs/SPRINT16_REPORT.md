# Sprint 16 — Cross-Filtering Interaction Infrastructure

**Date:** 2026-07-04
**Objective:** Build the interaction infrastructure for cross-filtering only — a global dashboard selection that chart clicks emit into. **No analytics consumption, no UI redesign, no drill-down, no side panels.**
**Result:** ✅ Global `DashboardContext` added; clicks on drug / disease / doctor / specialty charts emit a single shared selection. Nothing consumes it to change data yet (by design). Existing Month/Specialty/Doctor filters unchanged.

---

## Requirements → outcome

| # | Requirement | Outcome |
|---|---|---|
| 1 | Every chart click emits shared selection | ✅ Clickable `BarRank` rows + `Donut` slices call `select(type, value)` |
| 2 | Introduce a global `DashboardContext` | ✅ `lib/dashboard-context.tsx` (`DashboardProvider` + `useDashboard`), wraps the app in `app/layout.tsx` |
| 3 | Do not redesign the UI | ✅ No layout/visual change; only added `role/aria-pressed/data-selected` + inline `cursor:pointer` on clickable rows. No CSS-file changes (no styling rule targets `data-selected`) |
| 4 | No side panels | ✅ none added |
| 5 | No drill-down | ✅ none |
| 6 | Existing filters keep working | ✅ `FilterBar`/URL/query layer untouched; Month/Specialty/Doctor still render and function |
| 7 | Clicking Drug / Disease / Doctor / Specialty updates the global selection | ✅ all four wired |
| — | No page-specific analytics yet | ✅ selection is set but **not read** by any query/render |

---

## Design

`Selection = { type: 'drug' | 'disease' | 'doctor' | 'specialty', value: string } | null` — a **single** shared value.

- `DashboardProvider` holds it in React state; `select(type, value)` **toggles** (re-selecting the active item clears it); `clear()` resets. Context default is a no-op, so `useDashboard()` is safe anywhere.
- This state is **orthogonal to the URL filters**. The URL filters (Month/Specialty/Doctor) drive the SQL; the selection is a separate in-memory cross-filter signal for a future sprint.

### Chart wiring (which chart emits which type)
| Page | Chart | `kind` |
|---|---|---|
| Overview | Top disease blocks (`BarRank`) | `disease` |
| Overview | Top active ingredients (`BarRank`) | `drug` |
| Diseases | Diagnoses by ICD block (`BarRank`) | `disease` |
| Diseases | ICD block share (`Donut`) | `disease` |
| Pharmacy | Top active ingredients / Top brands (`BarRank`) | `drug` |
| Doctor & Specialty | Top performing doctors (`BarRank`) | `doctor` |
| Doctor & Specialty | Visits by specialty (`BarRank`) | `specialty` |
| Labs & Scans | Top labs / Top scans | *(none — not a selection type; left non-clickable)* |

`BarRank`/`Donut` are now client components; a row/slice is interactive **only** when a `kind` prop is passed, so the non-selection charts render exactly as before.

---

## Files changed

| File | Change |
|---|---|
| `lib/dashboard-context.tsx` | **New.** `DashboardProvider`, `useDashboard`, `Selection`/`SelectionType`. |
| `app/layout.tsx` | Wrap the app shell in `<DashboardProvider>`. |
| `components/BarRank.tsx` | `'use client'`; optional `kind` → clickable rows emitting `select()`, with `aria-pressed`/`data-selected`. No-`kind` behaviour unchanged. |
| `components/Donut.tsx` | Optional `kind` → `onClick` on the pie emits `select()`. |
| `app/page.tsx`, `app/diseases/page.tsx`, `app/pharmacy/page.tsx`, `app/doctors/page.tsx` | Pass `kind` to the relevant charts. |

No query/API/data-layer changes; API contracts untouched; snapshot fallback and live queries unaffected.

---

## Verification (once)

Build: `npm run build` → ✅ compiled, types valid, **16/16 routes**, no errors.

Interaction (dev preview, driven via DOM):
- Server render exposes clickable rows: `/` → 5 `disease` + 5 `drug`; `/doctors` → 8 `doctor` + 19 `specialty`; Month/Specialty/Doctor filters still present.
- Click **doctor** bar "Mohamed Elshahat" → `aria-pressed` `false → true`, `data-selected` present.
- Click **specialty** bar "Internal Medicine" → it becomes pressed **and the doctor bar de-selects** — proving a **single global shared selection** across different charts and types.
- Re-click "Internal Medicine" → `aria-pressed` back to `false` (toggle clears).
- No displayed data changed (infrastructure only); existing filters unaffected.

---

## Scope note

The selection is intentionally **not consumed** anywhere yet — clicking a chart records the shared selection but does not filter, highlight, or drill down. Wiring the pages to react to the selection is the next sprint (Cross-filter analytics).
