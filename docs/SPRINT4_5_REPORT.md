# Sprint 4 & 5 — Doctor Analytics + Pharmacy Analytics

**Date:** 2026-07-04
**Type:** Presentation & feature-composition sprint (no architecture changes).
**Result:** The Doctor and Pharmacy pages were upgraded into executive-level analytics dashboards, reusing the Sprint 3 design language and existing components. No database, Supabase, import, auth, query, or API-contract changes were made.

---

## Files modified

| File | Change |
|------|--------|
| `app/doctors/page.tsx` | Rebuilt into an executive performance dashboard: KPI row + doctor ranking + specialty comparison + performance matrix. |
| `app/pharmacy/page.tsx` | Rebuilt into an executive medication dashboard: medication KPI cards + ingredient/brand charts with hierarchy. |
| `app/globals.css` | Added one reusable layout modifier `.lead` (lead/secondary chart grid) + its responsive collapse. No existing rules removed. |
| `app/doctors/loading.tsx` | **New** — route-level skeleton mirroring the doctor layout (KPI row → 2 charts → table). |
| `app/pharmacy/loading.tsx` | **New** — route-level skeleton mirroring the pharmacy layout (KPI row → lead chart grid). |

**Untouched (per constraints):** `lib/queries.ts`, `lib/types.ts`, `lib/supabase.ts`, `app/api/*`, import scripts, authentication, database schema. All data comes from the existing `getKpis`, `getSpecialties`, `getDrugs`, and `getTrends` functions with no signature changes.

---

## UI improvements

### Part A — Doctor Analytics (`/doctors`)
1. **Executive KPI row** — Total Visits, Avg Meds / Visit, Avg Labs / Visit, Avg Scans / Visit (with month-over-month delta pills on the rate metrics).
2. **Doctor ranking** — "Top performing doctors" ranked-bar chart (top 8 by visit volume), derived from the existing doctor matrix via a presentation-only `map`.
3. **Specialty comparison** — "Visits by specialty" ranked-bar chart.
4. **Performance table** — the existing sortable, searchable matrix (top 20 by volume), retitled "Doctor performance matrix".
5. **Loading/empty states** — tailored route skeleton; charts and table keep the Sprint 3 premium empty states.

### Part B — Pharmacy Analytics (`/pharmacy`)
1. **Medication KPI cards** — Avg Meds / Visit (+delta), Total Visits, Top Ingredient (Paracetamol · 13,928), Top Brand (Telfast · 7,663).
2. **Top Active Ingredients** — primary ranked-bar chart (emerald), 15 rows.
3. **Top Brands** — secondary ranked-bar chart (indigo).
4. **Chart hierarchy** — new `.lead` grid gives the ingredients chart visual primacy (1.35fr) over brands (1fr).
5. **Visual grouping** — KPI band, then a single grouped analysis row; consistent card + section-title rhythm.
6. **Executive layout** — same header/KPI/section pattern as the Overview and Doctor pages.
7. **Responsive cards** — KPI grid reflows (4→auto→2→1); `.lead` collapses to a single column ≤1024px.

---

## Components reused (no duplication)

| Component | Used for |
|-----------|----------|
| `PageHead` (+ `FilterBar`) | Page title + month/specialty filters on both pages |
| `KpiCard` (+ `TrendArrow`) | Every KPI card on both pages (8 total) |
| `BarRank` | Doctor ranking, specialty comparison, top ingredients, top brands |
| `DataTable` | Doctor performance matrix (sorting/search unchanged) |
| `.card`, `.section-title`, `.grid`, `.kpirow`, `.two`, `skeleton-*` | Shared layout/utility classes from the Sprint 3 system |

Only **one** new CSS utility (`.lead`) and **two** thin route skeletons were added — no component logic was duplicated.

---

## Build result

```
npm run build  →  ✓ Compiled successfully
                  ✓ Generating static pages (16/16)
```

- No type errors, no build warnings.
- Route sizes unchanged/stable: `/doctors` 1.25 kB, `/pharmacy` 710 B, shared JS 87.2 kB — confirming composition-only changes.

---

## Browser verification (once)

Verified at `http://localhost:3000`, viewport 1440×1000:

- **`/doctors`** → KPI row renders 77,306 / 2.42 / 0.84 / 0.12 with delta pills; "Top performing doctors" (indigo) and "Visits by specialty" (blue) charts side-by-side; performance matrix below.
- **`/pharmacy`** → DOM assertion: 4 KPI cards, Meds/Visit delta pill, 15 active-ingredient bars, section titles "Top active ingredients" / "Top brands", **no error overlay**. Ingredients chart is the wider lead column; brands secondary.
- Both routes returned HTTP 200; navigation, filters, sorting, and search all functional.

---

## Remaining Power BI differences

These BI-model capabilities are intentionally out of scope for this presentation sprint:

1. **Cross-filtering / click-to-slice** — Power BI visuals cross-filter each other on click; here filtering is via the header slicers only.
2. **Drill-down / drill-through hierarchies** — e.g. specialty → doctor → visit drill paths are not interactive.
3. **Scans / Visit per doctor** — the doctor matrix exposes Meds/V and Labs/V only (`DoctorRow` has no scans field); adding it would require a query change, which was out of scope.
4. **Specialty-filtered KPIs in fallback mode** — the bundled 2026 snapshot keys KPIs by month only, so the specialty slicer does not recompute KPI totals offline (the production Supabase SQL does filter by specialty).
5. **Advanced time intelligence** — only month-over-month deltas are shown; no YoY, rolling averages, or period-to-date measures.
6. **Bar-chart tooltips** — `BarRank` is a static SVG-free bar list (value shown inline); only the donut has hover tooltips. Power BI has rich tooltips on every visual.
7. **Export / bookmarks / Q&A** — no PDF/Excel export, bookmarks, or natural-language Q&A.
8. **Row-level security** — Power BI RLS roles are not modeled in the presentation layer.

---

*Sprint 4 & 5 complete. No further sprint started.*
