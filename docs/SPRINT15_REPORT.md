# Sprint 15 — Executive Interactive Dashboard (Global Doctor Filter)

**Date:** 2026-07-04
**Objective:** Add a global, URL-shareable **Doctor** filter that drives the executive pages, while preserving Power BI parity, parameterised SQL, snapshot fallback, and the existing UI/contracts.
**Result:** ✅ Doctor filter added and verified. It filters Overview, Diseases, Pharmacy, Diagnostics, and Trends; combines with Month + Specialty; and is shareable via query params.

---

## Requirements → outcome

| # | Requirement | Outcome |
|---|---|---|
| 1 | Add a global Doctor filter | ✅ Third `<select>` in `FilterBar` (`?doctor=`), values from live `listDoctors()` (61 doctors) |
| 2 | Doctor affects Overview / Diseases / Pharmacy / Diagnostics / Trends | ✅ all five wired |
| 3 | Preserve Month + Specialty filters | ✅ unchanged; all three combine |
| 4 | Shareable via URL query params | ✅ `?month=&specialty=&doctor=`; `FilterBar` preserves the other params on each change |
| 5 | Keep SQL parameterised | ✅ doctor is `$3` bind on `VISIT_FILTER` (`v.practitioner_name = $3`), `$2` on trends — no interpolation |
| 6 | Keep snapshot fallback | ✅ every function still falls back; `listDoctors` falls back to the snapshot's top-20 doctors |
| 7 | No UI redesign | ✅ reused existing `.filters select` styling; only added one dropdown |
| 8 | No API contract changes beyond the doctor filter | ✅ additive `doctor` query param on `/api/{kpis,drugs,diseases,diagnostics,trends}`; response shapes unchanged |

---

## Changes

**Data layer (`lib/queries.ts`, `lib/types.ts`)**
- `Filters` gains `doctor?: string | null`.
- `VISIT_FILTER` now binds `$1` month, `$2` specialty, **`$3` doctor** (`v.practitioner_name = $3`); every LIMIT shifted `$3 → $4`. Applied to `getKpis`, `getDiseases`, `getDiseaseDescriptions`, `getDrugs`, `getDiagnostics`, `getSpecialties`.
- `getTrends(specialty, doctor)` — added an optional second arg and a `$2` practitioner predicate. Existing single-arg callers are unaffected.
- `doctorParam()` trims the incoming value before binding (consistent with `specialtyParam`; DB stores `practitioner_name` trimmed).
- New `listDoctors()` — live async-warmed cache (same mechanism as `listMonths`/`listSpecialties`, sync contract), 2026-scoped distinct `btrim(practitioner_name)`; snapshot fallback = the bundled top-20 doctor names.

**UI (no CSS changes)**
- `FilterBar` takes a `doctors` prop and renders a Doctor `<select>` (reusing `.filters select`); `set('doctor', …)` preserves the other params.
- `PageHead` and the Overview page pass `doctors={listDoctors()}`.

**Pages** — Overview, Diseases, Pharmacy, Diagnostics, Trends now read `?doctor=` into `f.doctor` (and pass it to `getTrends`). The Doctors page is intentionally left unchanged (see scope note).

**API routes** — `/api/kpis`, `/api/drugs`, `/api/diseases`, `/api/diagnostics` read `doctor` into the filter; `/api/trends` passes it as the 2nd arg. Additive only.

---

## Verification (once)

Server: `next start` on the production build; DB cross-checks via direct `pg`.

**Doctor filter (`?doctor=Mohamed Elshahat`) — API vs direct DB:**

| Metric | API | DB | Match |
|---|---:|---:|:--:|
| Visits | 6,639 | 6,639 | ✅ |
| Patients | 3,057 | 3,057 | ✅ |
| Doctors | 1 | 1 | ✅ |
| Avg Meds / Visit | 2.07 | 2.07 | ✅ |
| Avg Labs / Visit | 1.80 | 1.80 | ✅ |
| Avg Scans / Visit | 0.08 | 0.08 | ✅ |

- **Baseline unchanged:** no filter → `77,306 visits / 61 doctors` (Power BI parity intact).
- **Filters combine:** `?specialty=Internal Medicine&doctor=Mohamed Elshahat&month=2026-03` → `684 visits, 1 doctor, 1 specialty` (all three applied).
- **Trends/Drugs honor doctor:** `/api/trends?doctor=…` returns that doctor's monthly series; `/api/drugs?doctor=…` → top ingredient `PARACETAMOL 1,463` (his subset).
- **Doctor dropdown present on all pages:** `/`, `/diseases`, `/pharmacy`, `/diagnostics`, `/trends`, `/doctors` all render the Doctor `<select>`.
- **Page reflects filter:** `GET /?doctor=Mohamed Elshahat` renders KPI cards `6,639 / 3,057 / 1`.
- **Doctor list = 61** (matches the doctors KPI). No snapshot-fallback warnings in the server log.

**Build:** `npm run build` → ✅ compiled, types valid, 16/16 routes, no errors.

---

## Scope note

The Doctor filter is required to affect exactly five pages (Overview, Diseases, Pharmacy, Diagnostics, Trends). The **Doctors page** shows the global dropdown but intentionally does **not** consume `?doctor=` — its specialty ranking and doctor matrix stay as-is. `getSpecialties` still passes a `$3` bind (null when unset), so nothing breaks.

No architecture, CSS, or existing API response shapes changed; snapshot fallback preserved throughout.
