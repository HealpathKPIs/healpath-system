# Sprint 8 — Live Supabase Data (Disease & Diagnosis)

**Date:** 2026-07-04
**Objective:** Convert **only** the Disease & Diagnosis page from snapshot to live Supabase data.
**Result:** ✅ The Disease page is fully live. One function converted; values match the Power BI model exactly.

---

## What the page needed

`app/diseases/page.tsx` uses two data functions:

| Function | Feeds | Status before | Action |
|---|---|---|---|
| `getDiseases(f, 10)` | ICD-block bar chart + donut | Already live (Sprint 7) | none |
| `getDiseaseDescriptions(f)` | "Diagnosis drill-down" table | Snapshot | **→ live (this sprint)** |

So exactly **one function** was converted: `getDiseaseDescriptions`.

---

## Change

Single edit to `lib/queries.ts` — `getDiseaseDescriptions` now runs a parameterised, read-only query via the existing `lib/pg.ts` infrastructure (`dbQuery` / `hasDb`) and the existing `VISIT_FILTER` (2026 reporting-window scope; `$1`=month, `$2`=specialty), with the snapshot kept as automatic fallback:

```sql
select dg.icd_desc as label, count(*)::int as value
from healpath.diagnosis_fact dg join healpath.visits v on v.visit_id = dg.visit_id
where <2026 window + optional month/specialty> and dg.icd_desc is not null and btrim(dg.icd_desc) <> ''
group by dg.icd_desc order by value desc limit 15
```

Fidelity detail: the model keeps the literal `"0"` icd_desc value, so the filter excludes only NULL/blank (it does **not** strip `'0'`) — reproducing the snapshot exactly.

**No other function, page, component, CSS, API contract, or shared infrastructure was touched.** `lib/pg.ts` was reused as-is.

---

## Verification (once)

Server: `next start` on the production build.

**KPI/data match vs Power BI model** — `/api/diseases` (no filter), drill-down descriptions:

| # | Description | Live | Model | Match |
|---|---|---:|---:|:--:|
| 1 | Vitamin D deficiency, unspecified | 5,658 | 5,658 | ✅ |
| 2 | Acute nasopharyngitis [common cold] | 5,245 | 5,245 | ✅ |
| 3 | Acute bronchitis, unspecified | 4,922 | 4,922 | ✅ |
| 4 | "0" | 3,336 | 3,336 | ✅ |

All 15 rows matched (pre-wire verification confirmed the full list).

**Proof it is live, not snapshot fallback** (the snapshot ignores `specialty`):

| Request | Live API top-3 | Direct DB cross-check | Snapshot would return |
|---|---|---|---|
| `?specialty=Internal Medicine` | Vitamin D 2,818 · Mixed hyperlipidaemia 2,681 · IBS 2,633 | **identical** | 5,658 / 5,245 / 4,922 (wrong — ignores specialty) |

The filtered API response equals an independent direct-DB computation and differs from the unfiltered list — confirming the live path. The `/diseases` page HTML renders the live drill-down; no fallback warnings or errors in the server log.

---

## Build

`npm run build` → ✅ Compiled successfully, types valid, **16/16 pages**, no errors. Route sizes unchanged (data-layer-only change).

---

## Scope confirmation

- Modified only `getDiseaseDescriptions` (the one function the Disease page still needed).
- No other page, component, CSS, API route, or shared architecture changed; `lib/pg.ts` reused.
- Still snapshot-backed for their own future sprints: `getSpecialties` (Doctors), `getDiagnostics` (Labs & Scans), and the sync enumerations `listMonths`/`listSpecialties`.
