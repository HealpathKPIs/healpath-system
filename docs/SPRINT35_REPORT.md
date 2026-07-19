# Sprint 35 Report - Chronic Analytics

## Scope

- Created `/chronic/analytics` as a second chronic page.
- Reused the existing HealPath layout, cards, filters, BarRank chart pattern, and chronic trend chart styling.
- Kept the work additive to the chronic dashboard surface.

## Delivered

- **Issue Analytics:** Top Issues, Distribution, Pareto 80/20, Period Trend.
- **Recommendation Analytics:** Top Recommendations, Acceptance, Trend.
- **Consultant Analytics:** Patients, Recommendations, Issues, Average Medications.
- **Medication Analytics:** Top Medications, Recommendations, Issue Rate.
- Added Period / Consultant / Issue / Recommendation filters across the analytics page.
- Added an Analytics action to the `/chronic` header.

## Data Notes

- Reused the existing `getChronicOverview` chronic row fetch.
- Added derived in-memory analytics for Pareto, recommendation acceptance, consultant metrics, and medication metrics.
- Preserved Sprint 34 chronic counting semantics: POST rows drive medication, issue, and recommendation volumes; Period remains the primary timeline.

## Explicit Non-Goals Preserved

- No Patient Explorer.
- No SQL/schema changes.
- No import changes.
- No API route changes.
- No redesign.

## Verification

- `npm.cmd run build` completed successfully.
- Build output included `/chronic/analytics` as a dynamic route.

---
---

# Sprint 35 (Part B) — Chronic Data Normalization Layer

> This file holds two same-numbered sprints: Part A above (Chronic Analytics page) and Part B below (the import-time Data Normalization layer).

**Date:** 2026-07-15
**Objective:** A permanent data-quality layer in the Chronic import: every row is normalized **before** anything is written to Supabase, so the database never stores different spellings of the same issue. Not a dashboard or UI feature.
**Result:** ✅ Delivered in 3 files; verified end-to-end (module unit checks + a real import round-trip against Postgres, cleaned up after).

## Architecture

**`lib/chronic-normalizer.ts`** (new) — ALL normalization logic lives here. Pure and client-safe.

- **Generic pipeline:** `createChronicNormalizer({ canonical, mappings, threshold })` returns a memoized normalizer. Resolution order per value:
  1. **Explicit mapping rule** → reason `mapped`
  2. **Exact/fuzzy match ≥ 90%** (Levenshtein ratio over a normalization key) against the official list → canonical spelling, reason `normalized` (or `exact` if already canonical)
  3. **No match** → keep the original value, reason `unknown`
- **Normalization key** (matching only, never stored): trim → strip surrounding quotes → lowercase → drop a leading `Issue N` label → fold `: ; , - _` to spaces → drop other/duplicated punctuation → collapse multiple spaces.
- **Future-ready:** the same factory serves Issues today and Recommendations / Consultants / Medication Names / Diagnoses tomorrow — each future entity only needs its canonical list + mapping rules. The **Recommendation normalizer already exists** as infrastructure (empty canonical list, no rules → accepts values as-is, zero report noise).

### Issues — the 13 official categories
`0 · Acc. to DAPT score · Acc to FRAX score · Acc to MMSE score · Cannot be taken as chronic · Contraindicated with · Dose is decreased for long time use · exaggerated protocol · Mild interaction · Moderate interaction · Not related to the diagnosis · Severe interaction · To be re-considered if the patient still needs it or not`

### Explicit mapping rules
| Original | → Normalized |
|---|---|
| No Chronic Found, NO NEED FOR CHRONIC | Cannot be taken as chronic |
| Not related to diagnosis | Not related to the diagnosis |
| moderate, Moderate interactionue | Moderate interaction |
| As is, re, 1 | 0 |

## Import integration (`app/api/chronic/import/route.ts`)

`normalizeChronicRows()` runs **after validation/calendar resolution and before the duplicate check and every INSERT** — nothing reaches the database unnormalized. Per row (`normalizeChronicRow()`):
- every **`Issue 1..N` field inside `row_data`** is normalized in place (non-issue fields untouched);
- the **`issue` summary column is rebuilt from the normalized fields**, so column and JSON can never disagree;
- the recommendation passes through the (rule-less) recommendation normalizer.

**Report** — `{ rows, normalized, mapped, unknown }` is returned by both `mode=preview` and `mode=import`, and `/chronic/import` shows it after Validate (Rows / Normalized / Mapped / Unknown card). The page **contains no normalization logic** — it only calls the module for a client-side dry-run; the server re-runs it authoritatively.

**Logging** — new audit table **`healpath.chronic_normalization_log`** (`batch_id, field, original, normalized, reason, occurrences, imported_at`), created idempotently and written **in the same import transaction**: one row per distinct Original → Normalized change per batch.

## Verification

**Build:** ✅ EXIT 0, 23/23 routes. *(A stale scratch file from an earlier session's verification was removed when it broke type-checking — not app code.)*

**Module checks:** 8/8 explicit mapping rules; 6/6 normalize/fuzzy/unknown cases (`" ISSUE 5 : Moderate interaction "` → Moderate interaction, `"exaggrated protocol"` → exaggerated protocol, `"Cannot be taken as Chronic"` → canonical, exact values untouched, novel values kept with reason `unknown`); row normalization confirmed (issue fields + rebuilt summary + untouched non-issue fields; report `{rows:2, normalized:1, mapped:1, unknown:1}`).

**Live import round-trip** (2×2 rows with messy issues, then deleted):
- Response: `normalization: { rows: 4, normalized: 4, mapped: 2, unknown: 2 }`.
- **Stored values are normalized** — `row_data.'Issue 1'` = `"Cannot be taken as chronic"` (was `"No Chronic Found"`), `"Moderate interaction"` (was `" ISSUE 5 : Moderate interaction "`), `"Severe interaction"` (was `"severe interaction"`); unknown `"totally novel issue"` kept as-is; the `issue` column matches the normalized fields exactly.
- **normalization_log**: `[mapped] "No Chronic Found" → "Cannot be taken as chronic" ×2`, `[normalized] "ISSUE 5 : Moderate interaction" → "Moderate interaction" ×2`, `[normalized] "severe interaction" → "Severe interaction" ×2`, `[unknown] "totally novel issue" ×2`.
- Cleanup: all test rows, the batch row, and the log entries removed (0 remnants).
- **Dashboard unchanged:** `/chronic` renders 200 with identical query behavior (no KPI/SQL changes).

## Notes
- `lib/queries.ts` keeps its Sprint 34.2 **read-path** canonicalization so rows imported *before* Sprint 35 still display consistently; it is idempotent for the now-normalized data. Unifying both layers onto `chronic-normalizer` is a clean future refactor (out of scope per the restrictions).
- Data already in the database was intentionally not rewritten (normalization applies at import time); a one-off backfill can reuse `normalizeChronicRow` if ever desired.
