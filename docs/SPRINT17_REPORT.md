# Sprint 17 — Activate Cross-Filtering

**Date:** 2026-07-04
**Objective:** Consume the shared `DashboardContext` selection so chart clicks actually filter the dashboard, preserving Power BI parity when no selection exists.
**Result:** ✅ Clicking a Drug / Disease / Doctor / Specialty now filters the affected pages; re-click clears; existing dropdowns unchanged; parity intact with no selection.

---

## How it works (the client→server bridge)

The selection lives in the client-only `DashboardContext` (reused **exactly** as built in Sprint 16), but the pages fetch data in **server components**. To bridge them without redesigning the context:

- A chart click updates the context (drives the `aria-pressed` visual) **and reflects the single selection into the URL** as `?sel=<type>&selv=<value>` (`router.replace`, alongside the existing `?month/specialty/doctor`).
- Server pages call **`resolveFilters(searchParams, honor)`**, which applies the required priority:

  **DashboardContext selection (`?sel`) → URL dropdown filter → default (null).**

  Doctor/specialty selections resolve onto the *same* doctor/specialty filter, so they **behave exactly like the dropdown**. Drug/disease are new visit-population filters.
- **Re-click** removes `?sel/?selv` → back to the default (parity).

This keeps SQL parameterised, contracts stable, and adds no new components / panels / drill-down.

### Effective-filter priority
```
specialty = sel(specialty) ?? url.specialty ?? null
doctor    = sel(doctor)    ?? url.doctor    ?? null      (Doctors page: forced null — inert)
drug      = page honors drug    ? sel(drug)    : null
disease   = page honors disease ? sel(disease) : null
month     = url.month ?? null
```

### Cross-filter SQL (parameterised)
`VISIT_FILTER` gained `$4` drug / `$5` disease (LIMIT → `$6`):
```sql
and ($4::text is null or v.visit_id in
     (select xdf.visit_id from healpath.drug_fact xdf where xdf.ac = $4 or lower(btrim(xdf.brand)) = $4))
and ($5::text is null or v.visit_id in
     (select xdg.visit_id from healpath.diagnosis_fact xdg where xdg.icd_block = $5))
```
`getTrends(specialty, doctor, drug, disease)` gained the same drug/disease conditions. Drug matches active ingredient **or** brand (so both drug-chart bars filter).

### Page honor matrix (per requirements 1 & 2)
| Page | drug | disease |
|---|:-:|:-:|
| Overview | ✓ | ✓ |
| Diseases | ✓ | ✗ (it *is* the disease view) |
| Pharmacy | ✓ | ✓ |
| Labs & Scans | ✗ | ✓ |
| Trends | ✓ | ✓ |
| Doctor & Specialty | ✗ | ✗ |

(month/specialty/doctor are the existing filters; doctor stays inert on the Doctors page per Sprint 15.)

---

## Files changed
| File | Change |
|---|---|
| `lib/types.ts` | `Filters` gains `drug`, `disease` |
| `lib/queries.ts` | `VISIT_FILTER` + `$4/$5`; `visitParams()`; `resolveFilters()`; every function passes 5 binds; `getTrends(specialty, doctor, drug, disease)` |
| `components/BarRank.tsx` | click reflects selection to `?sel/?selv` (context still drives pressed visual); toggle-clear |
| `components/Donut.tsx` | same URL reflection on slice click |
| `app/page.tsx`, `app/diseases/page.tsx`, `app/pharmacy/page.tsx`, `app/diagnostics/page.tsx`, `app/trends/page.tsx`, `app/doctors/page.tsx` | use `resolveFilters` with the page's honor set |

**No API contract changes** (the API routes don't need `sel`; pages read it directly). No UI/CSS redesign, no new components, no side panel, no drill-down. Snapshot fallback unchanged.

---

## Verification (once)

Build: `npm run build` → ✅ compiled, types valid, **16/16 routes**, no errors.

Direct-DB targets: drug PARACETAMOL → 13,911 visits; disease "Acute upper respiratory infections" → 13,493; doctor Mohamed Elshahat → 6,639.

| Scenario | Result |
|---|---|
| **Parity (no selection)** | `/` visits **77,306**, `/diseases` top block **13,701**, `/diagnostics` labs/v **0.84** — exact Power BI parity |
| **Drug = PARACETAMOL** | `/` visits → **13,911**; `/diseases` top block **13,701 → 6,601** (honored); `/diagnostics` labs/v stays **0.84** (not honored) |
| **Disease = Acute URI** | `/` visits → **13,493**; `/diagnostics` labs/v **0.84 → 0.08** (honored); `/diseases` top block stays **13,701** (not honored) |
| **Doctor ≡ dropdown** | `?sel=doctor&selv=Mohamed Elshahat` = **6,639** = `?doctor=Mohamed Elshahat` |
| **Re-click clears** (real browser click on Overview) | click PARACETAMOL → URL `?sel=drug&selv=PARACETAMOL`, visits **77,306 → 13,911**, `aria-pressed=true`; re-click → URL **cleared**, visits **→ 77,306**, `aria-pressed=false` |

All four required demonstrations pass. Existing Month/Specialty/Doctor dropdowns keep working (`FilterBar` untouched; preserves all params).

---

## Notes
- **Priority (req 7):** an active selection overrides the same-dimension dropdown; clearing it restores the dropdown value.
- Selection is **per page** (reflected in the URL; not persisted across `Nav` navigation — same behaviour as the existing dropdown filters).
- Doctor bars live only on the Doctors page (inert there by Sprint-15 design); the doctor↔dropdown equivalence is demonstrated on doctor-honoring pages via `?sel=doctor` vs `?doctor=`.
