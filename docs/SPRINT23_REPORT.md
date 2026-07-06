# Sprint 23 — Executive Command Palette

**Date:** 2026-07-05
**Objective:** A premium command launcher for HealPath. **Not a new search system** — it reuses the existing search, routing, filters, and page logic.
**Result:** ✅ Linear/Raycast-style palette: Ctrl+K (or the nav search button) opens it, it fans out to the existing `/api/search`, and selecting a result navigates using the existing `?q=` page filter.

---

## What it does (and reuses)

- **Open:** `Ctrl/Cmd + K` (global toggle) **or** a search button added to the top of the sidebar nav (dispatches a `healpath:command-open` window event). **Close:** `Esc`, click outside, or selecting an item.
- **Search sources — reuses the Sprint 19 `/api/search` verbatim** (no new SQL/API/engine). The palette fetches all four scopes (`doctors`, `pharmacy`, `diagnostics`, `diseases`) in parallel (debounced 250 ms, min 2 chars) and **round-robin merges** them to a **max of 8** diverse results.
- **Recognised entities → icon + category:** Doctor 👨‍⚕️, Specialty 🩺, Active Ingredient / Medication 💊, Brand 🏷️, Laboratory 🧪, Scan 🩻, Diagnosis (with its ICD code) 📄.
- **Selection reuses existing navigation** — each result routes to the entity's page with the existing `?q=` filter (which the page's SearchBox and data already consume from Sprint 19):
  - Doctor / Specialty → `/doctors?q=…`
  - Ingredient / Brand / Medication → `/pharmacy?q=…`
  - Laboratory / Scan → `/diagnostics?q=…`
  - Diagnosis / ICD → `/diseases?q=…`
- **UX:** ↑/↓ move the highlighted row, Enter selects, Esc closes; light backdrop blur, rounded corners, soft shadow, smooth open animation, body-scroll lock, `prefers-reduced-motion` respected. Styled with the existing design tokens (inline) — **no `globals.css` change**.

---

## Files changed (minimal — 3)
| File | Change |
|---|---|
| `components/CommandPalette.tsx` | **New** — the launcher (reuses `/api/search` + `?q=` routing) |
| `app/layout.tsx` | Mount `<CommandPalette />` |
| `components/Nav.tsx` | Add the sidebar **Search…** button (`Ctrl K` hint) that opens it |

No SQL / API / backend / auth / DB / routing / filter changes. No new search engine, no duplicate filters.

---

## Verification (once)

Build: `npm run build` → ✅ EXIT 0, "Compiled successfully", 17/17 routes, no type errors.

Browser (`http://localhost:3000`), driven via DOM:
- **Open:** dispatching the nav-button event (and the equivalent Ctrl+K toggle) shows `role="dialog"` "Command palette".
- **Search Doctor** — `Mohamed` → 5 results, all **👨‍⚕️ … [Doctor]** (e.g. *Mohamed Elshahat*).
- **Search Medication** — `Paracetamol` → 8 results across **💊 [Active Ingredient]**, **🏷️ [Brand]**, **💊 [Medication]**.
- **Search Vitamin D** — cross-scope: **🧪 Vitamin D [Laboratory]** (matches the spec example) plus **💊 [Active Ingredient]** and **📄 [Diagnosis]**.
- **Search ICD** — `J06` → **📄 Acute upper respiratory infection, unspecified (ICD J06.9) [Diagnosis]** (+ J06.8 / J06.0 / J06).
- **Enter navigates correctly** — pressing Enter navigated to **`/diseases?q=Acute upper respiratory infection, unspecified`**, the palette **closed**, and the destination page's SearchBox picked up the `?q` value — i.e. it reused the existing filter/highlight, no duplicate routing.

*(Note: the full-screen backdrop-blur overlay taxes the preview's screenshot compositor, so a still capture timed out; the palette and all interactions were verified functionally via DOM inspection.)*

---

## Design
Modern command palette inspired by Linear / Raycast / Vercel — icon, primary title, small category badge per row; highlighted current row; premium spacing; reuses the existing design language (CSS variables, shadow tokens).
