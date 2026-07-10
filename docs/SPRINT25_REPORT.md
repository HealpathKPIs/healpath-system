# Sprint 25 — Executive Compare Center

**Date:** 2026-07-06 (completed after Sprint 26)
**Objective:** A reusable comparison drawer — not a page, not a split dashboard — that reuses existing data, queries, context, and routing. No backend, no SQL, no new API.
**Result:** ✅ ⚖ Compare button beside the global filters opens a premium right-side drawer supporting Doctor vs Doctor, Medication vs Medication, and Month vs Month — built entirely from the existing API routes, with Quick Actions that reuse the existing filters.

---

## How it reuses what exists

- **Open:** a small **⚖ Compare** button rendered inside `FilterBar` — i.e. beside the Month/Specialty/Doctor dropdowns on every page (Overview header + all sub-pages). Close: ✕, Esc, or click-outside; body scroll locks while open; slide-in respects `prefers-reduced-motion`.
- **Selectors:** the drawer's Left/Right dropdowns are fed by the **same lists the global filters use** — `FilterBar`'s existing `months` and `doctors` props (live `listMonths`/`listDoctors`) pass straight through; medication options come from the existing `/api/drugs` result (ingredients + brands). No new search logic.
- **Profiles from existing API routes only** (`/api/kpis`, `/api/drugs`, `/api/diagnostics`, `/api/trends`, `/api/specialties`):
  - **Doctor:** `?doctor=` on kpis/drugs/diagnostics/trends → Visits, Avg Medications, Top Medication, Top Laboratory, Top Specialty (from the existing doctor matrix), Top Trend (from the doctor's meds delta).
  - **Month:** `?month=` on kpis/drugs/diagnostics/specialties → same sections; Top Trend derived from that month's existing trend point vs the prior one.
  - **Medication:** the existing APIs accept **no medication filter**, so only **Prescriptions** (the medication's count from `/api/drugs`) is comparable. Per the spec — *"only display values already available; if unavailable, hide the section; never fabricate"* — the other sections are hidden. Making them available would have required editing all five API routes (>6 files), which the rules forbid.
- **Comparison cards:** compact executive cards — label, `LEFT vs RIGHT`, and for numeric metrics a `▲/▼/≈ ±%` delta chip.
- **Quick Actions** reuse the existing routing + filters verbatim: Open Left/Right in Dashboard (`/?doctor=` / `/?month=` / `/?sel=drug&selv=`), plus Trends / Pharmacy / Diagnostics with the Left entity's filter. No duplicated routing.

## Files changed (2 — well under the 6-file limit)
| File | Change |
|---|---|
| `components/CompareCenter.tsx` | **New** — the drawer (profiles, cards, quick actions) |
| `components/FilterBar.tsx` | ⚖ Compare button + mounts the drawer (passes its existing `months`/`doctors` through) |

No backend / SQL / API / auth changes; `DashboardContext`, queries, and routing untouched and reused.

---

## Verification (once)

Build: ✅ EXIT 0, "Compiled successfully", 18/18 routes.

Browser (`http://localhost:3000`, driven via DOM):

| Demo | Result |
|---|---|
| **Doctor vs Doctor** (Mohamed Elshahat vs Abeer Mohamed) | Visits **6,639 vs 4,108 ▲ +62%**; Avg Medications **2.07 vs 3.76 ▼ −45%**; Top Medication *Paracetamol vs Paracetamol*; Top Laboratory *CBC vs CBC*; Top Specialty *Internal Medicine vs Pediatrics*; Top Trend *Decreasing vs Decreasing*. (6,639 / 2.07 match the doctor's known live KPIs.) |
| **Medication vs Medication** (PARACETAMOL vs telfast) | Prescriptions **13,928 vs 7,663 ▲ +82%** (exact live counts); all unavailable sections **hidden** — nothing fabricated. |
| **Month vs Month** (Mar vs Apr 2026) | Visits **8,849 vs 10,888 ▼ −19%**; Avg Medications **2.62 vs 2.18 ▲ +20%** (exact trend values); Top Specialty *Internal Medicine vs Family Medicine (Immediate Booking)*; Top Trend *Stable vs Decreasing* (consistent with the month deltas). |
| **Quick Actions** ("Open Left in Dashboard", month mode) | Navigated to **`/?month=2026-03`**, drawer closed, the existing Month dropdown synced to *Mar 2026*, Overview Visits KPI showed **8,849** — existing routing + filters reused exactly. |

---

## Notes
- The medication Quick Action uses the existing `?sel=drug&selv=` cross-filter; each destination page applies it per the established honor matrix (e.g. Diagnostics ignores drug filters by design).
- The drawer fetches through the app's own API routes — the browser-side way to reuse the existing live queries (with their snapshot fallback) without adding any backend.
