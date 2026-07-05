# Sprint 19 — Universal Search Experience

**Date:** 2026-07-05
**Objective:** Upgrade every page search into one fast, reusable, executive-grade search.
**Result:** ✅ A single `SearchBox` autocomplete (ILIKE live / snapshot fallback, debounced, min-2, highlighted, keyboard-navigable) drives search on Diseases, Pharmacy, Diagnostics, and Doctors. Selecting a result filters the page via `?q`.

---

## What was built

**One reusable component — `components/SearchBox.tsx`** (used verbatim on all four pages):
- Reuses the existing `.search` input styling (no CSS-file changes; dropdown styled inline).
- **Debounce 300 ms**, **minimum 2 characters** before querying.
- Fetches `GET /api/search?scope=<scope>&q=<term>` → dropdown of up to 8 hits.
- **Highlights** the matched substring (`<mark>`), shows a scope hint (Ingredient/Brand/Doctor/Lab…).
- **Keyboard navigation**: ↑/↓ move, **Enter** selects (or applies the typed term), **Esc** closes; mouse hover/click also select.
- Selecting a hit sets `?q=<value>` (preserving all other params); the server page consumes it and filters.

**Backend — `searchOptions(scope, q)` in `lib/queries.ts` + `app/api/search/route.ts`:**
- **Live:** SQL **ILIKE** (`%term%`) — case-insensitive, partial. **Snapshot fallback:** `includes()`.
- Per-scope search columns:

| Scope | Searches |
|---|---|
| `diseases` | `diagnosis_fact.icd_desc` (diagnosis name) + `diagnosis_fact.diseases` (**ICD code**) |
| `pharmacy` | `drug_fact.brand` + `drug_fact.ac` (ingredient) + `drug_fact.medications` (generic) |
| `diagnostics` | `lab_fact.tests` + `scan_fact.tests` |
| `doctors` | `visits.practitioner_name` + `visits.doctor_specialty` |

**Page filtering (`?q` → `Filters.search`):** `resolveFilters` now reads `?q`; the search-enabled queries add a parameterised `ILIKE $7` filter (snapshot: `includes`) — `getDiseaseDescriptions` (`icd_desc`/`diseases`), `getDrugs` (`ac`/`brand`/`medications`), `getDiagnostics` (`tests`), `getSpecialties` doctor matrix (`practitioner_name`/`doctor_specialty`). All SQL stays parameterised.

**Cleanup:** the old `DataTable` client-side search input was removed on Diseases/Doctors (the SearchBox replaces it — one search per page).

---

## Files changed
| File | Change |
|---|---|
| `components/SearchBox.tsx` | **New** reusable autocomplete |
| `app/api/search/route.ts` | **New** `/api/search` route |
| `lib/queries.ts` | `searchOptions()` + `SEARCH_SQL`/snapshot; `Filters.search` via `resolveFilters`; `ILIKE $7` in the 4 page queries + snapshot `applySearch` |
| `lib/types.ts` | `Filters.search` |
| `app/diseases/page.tsx`, `app/pharmacy/page.tsx`, `app/diagnostics/page.tsx`, `app/doctors/page.tsx` | Add `<SearchBox scope=…>`; Diseases/Doctors drop the DataTable search |

No UI/CSS redesign; existing Month/Specialty/Doctor filters and cross-filtering untouched (SearchBox preserves all URL params). API response shapes unchanged (new route is additive).

---

## Verification (once)

Build: `npm run build` → ✅ compiled, types valid, 17/17 routes, no errors.

**Autocomplete API** (`/api/search`):
| Query | Result |
|---|---|
| `scope=diseases q=J06` | 4 hits, first = *Acute upper respiratory infection, unspecified* (hint `J06.9`) |
| `scope=pharmacy q=telfast` | 5 hits, first = `telfast` (Brand) |
| `scope=doctors q=Mohamed` | 5 hits, first = `Mohamed Elshahat` (Doctor) |
| `scope=diagnostics q=CBC` | 5 hits, first = `Complete Blood Count - CBC` (Lab) |
| `scope=diseases q=J` | 0 hits (**min-2 guard**) |

**Page filtering via `?q`:**
- `/diseases?q=J06` → drill-down shows only J06 diagnoses (respiratory / laryngopharyngitis), not the default top list. **(ICD code returns the diagnosis.)**
- `/pharmacy?q=telfast` → brands bar filtered to `telfast`. **(Drug filters pharmacy.)**
- `/doctors?q=Mohamed` → matrix shows only "Mohamed …" doctors. **(Doctor filters doctors.)**
- `/diagnostics?q=CBC` → labs bar filtered to `Complete Blood Count - CBC`. **(Lab filters diagnostics.)**

**Client behaviour (real browser on `/diseases`):** typing `respirat` → after the 300 ms debounce the dropdown opened with 8 options; `<mark>respirat</mark>` highlighted; **ArrowDown×2** activated option index 1; **Enter** set `?q=Other acute upper respiratory infections of multiple sites` and filtered the page. **(Diagnosis text returns the diagnosis.)**

All five required demonstrations pass.

---

## Notes
- Search is **page-local** (`?q` is not carried across `Nav` navigation), matching an executive "search within this view" expectation.
- Case-insensitive + partial everywhere (ILIKE live, `includes` snapshot). Generic-name matches appear in the pharmacy autocomplete and also filter the ingredient/brand bars (queries match `ac`/`brand`/`medications`).
