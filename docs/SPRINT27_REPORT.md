# Sprint 27 — Executive UX Improvements (Part A) & Design System (Part B)

> This file holds two same-numbered sprints: **Part A** (Executive UX code changes, earlier on 2026-07-09) and **Part B** (design system documentation, appended below — see the second half of this file).

**Date:** 2026-07-09
**Objective:** Three UX upgrades — compact scenario panel, Admin Upload History, and a Settings page. No SQL, no API redesign, no routing redesign.
**Result:** ✅ All three delivered in **4 code files** (limit 6), reusing DashboardContext, existing classes, and the existing `/api/kpis` endpoint.

---

## 1. Compact floating Executive Scenario panel

The Sprint-24 full-height (100vh) slide-in drawer in `components/ExecutiveExperience.tsx` was replaced with a **compact floating panel**:

- **Bottom-right, non-modal** — `min(350px, 100vw−32px)` wide, max 58vh tall (measured 350×353px), no backdrop; the dashboard stays interactive.
- **Shows only while an entity is selected** — renders `null` otherwise; opens from a DashboardContext selection (doctor/drug) or an Executive Feed card; **auto-hides when the selection is cleared elsewhere** (e.g. re-clicking the chart bar).
- **Visible ✕ button**; **closing clears the selection everywhere it lives**: the panel, the DashboardContext (`clear()`), and the URL mirror (`?sel/?selv`, plus `?doctor` when the selection was doctor-driven) — so the dashboard data resets too.
- Premium compact rows (label/value lines, status pill), design tokens, reduced-motion-aware entrance.

## 2. Admin → Upload History

Below the Data Import card (`app/admin/import/page.tsx`): a compact **Upload History** table — columns exactly **Date | File | Status | Rows | Duration** — showing the **latest 10** uploads. The import pipeline has no server-side upload log, so per the spec ("UI only if persistence is unavailable") history is **browser-local** (`localStorage: hp-upload-history`); entries are recorded automatically from the existing import stream (`done` → Completed with row total + duration, `error` → Failed). Table reuses the existing `.table-wrap` styles; empty state: "No uploads recorded on this device yet."

## 3. Settings page (`/settings`)

New `app/settings/page.tsx` (+ sidebar link in `Nav.tsx`), sections as specified:

| Section | Content |
|---|---|
| **Account** | Change Password — explicit placeholder (disabled; the app has shared access, no user accounts) |
| **Appearance** | Light / Dark / System segmented control, persisted; honest note that the design system currently ships light-only tokens |
| **Dashboard** | **Enable Animations** (persisted preference) · **Show Executive Feed** — functional: `ExecutiveFeed` reads it and hides itself when off |
| **About** | **Version** (from `package.json`, v1.0.0) · **Database Status** via the existing `/api/kpis` — "Connected · N visits" or "Unavailable — snapshot fallback" |

Preferences persist in `localStorage: hp-settings` (no backend, no new API).

---

## Files changed (4 code files)
| File | Change |
|---|---|
| `components/ExecutiveExperience.tsx` | Drawer → floating panel; close clears selection; `ExecutiveFeed` respects the Show-Feed setting |
| `app/admin/import/page.tsx` | Record + render Upload History |
| `app/settings/page.tsx` | **New** — Settings page |
| `components/Nav.tsx` | Settings link + icon |

---

## Verification (once)

Build: ✅ EXIT 0, "Compiled successfully", **19/19** routes (`/settings` added).

Browser (driven via DOM):
- **Panel**: hidden with no selection → click PARACETAMOL bar → URL `?sel=drug&selv=PARACETAMOL`, visits **13,911**, panel appears (350×353px — not full height), rows show *PARACETAMOL / 13,911 / 9,328*; **✕ visible**; clicking ✕ → panel gone, **URL cleared**, bar `aria-pressed=false`, dashboard reset.
- **Upload History**: section renders with empty state; with an entry, table shows `Date | File | Status | Rows | Duration` (e.g. *HealPath_BI_Starter.xlsx · Completed · 488,620 · 169.6s*). Demo seed removed after the check.
- **Settings**: all four sections render; Change Password placeholder; Light/Dark/System selectable (persisted `appearance:"dark"`); Version **v1.0.0**; Database Status **"Connected · 77,738 visits"**; Show-Executive-Feed toggled off → persisted → **Overview feed hidden**; settings restored to defaults afterwards.

### Data observation (not a code issue)
The 2026-window visit count now reads **77,738** (was 77,306 at the original import) — additional data has been imported into the live DB since Sprint 26. Metrics remain correctly scoped; the baseline is simply data-dependent. Recorded in PROJECT_CONTEXT.

---
---

# Sprint 27 (Part B) — HealPath Design System Documentation

**Date:** 2026-07-09 (later the same day)
**Objective:** Create `HEALPATH_DESIGN_SYSTEM.md` — the design system documentation — using the uploaded `DESIGN.md` (an external automotive-brand design analysis) as **inspiration only**. Documentation only; no code, CSS, or component changes.
**Result:** ✅ One new file created: [`HEALPATH_DESIGN_SYSTEM.md`](../HEALPATH_DESIGN_SYSTEM.md). Zero application changes — no build required.

## What was produced

A complete 12-section design system document, **grounded in the shipped implementation** (the real `globals.css` tokens and Sprint 3–27 component conventions), so the documentation describes reality rather than aspiration:

1. **Brand Philosophy** — Executive · Clinical · Premium · Minimal · Fast · Trustworthy · Data-first, each mapped to a concrete UI behavior; the HealPath signature defined (layered near-white canvas, single indigo action color, heavy tabular numerals vs quiet labels).
2. **Color Tokens** — Primary/Secondary (accent family), Success/Warning/Danger/Info, Surface/Background/Card, Border tiers, and the fixed chart palette (meds/labs/scans + categorical) — all as the shipped CSS custom properties.
3. **Typography** — Display / Heading / Title / Body / Caption / Numbers / KPI scale on Inter, with the tracking-scales-with-size and tabular-numerals rules.
4. **Spacing** — the requested 4→80 scale mapped to actual usage (card padding, grid gaps, page gutters).
5. **Border Radius** — Cards 12 / Buttons 9–10 / Inputs 10 / Drawer 14–16 / Dialog 16 / pills 999.
6. **Elevation** — Card→Hover→Drawer→Modal ladder from the shipped shadow tokens + focus ring.
7. **Motion** — Page transition 210ms, hover 200ms, drawer slides 160–200ms, counter 600ms, chart 500ms; duration bands and easings; reduced-motion mandate.
8. **Component Rules** — KPI cards, charts, Executive Feed, Executive Scenario, Compare Center, Import Center, Command Palette, tables, filters, search, Settings, Upload History.
9. **Dashboard Rules** — max 5 KPI cards/row, max 2 charts/section, whitespace rhythm, title/action/hierarchy rules.
10. **Interaction Rules** — hover, focus, single-global-selection, loading/skeleton, empty, success, error treatments.
11. **Accessibility** — contrast targets, keyboard coverage, universal focus ring, reduced motion, ARIA conventions.
12. **Future Components** — reserved placeholders: Notification Center, AI Assistant, Alerts, Forecast, Compare (extension), Import Wizard.

## Inspiration handling

The source `DESIGN.md` documents an automotive corporate brand. Per the rules, **no branding, names, colors, or typefaces were copied** — what carried over is the *discipline*: a single primary action color, a weight-contrast typographic signature, token-references-over-inline-hex, do/don't-style rules, and a restrained accent policy. Every value in the HealPath document is HealPath's own shipped token.

## Scope confirmation

- Files: **1 new** (`HEALPATH_DESIGN_SYSTEM.md`), plus this report update and `PROJECT_CONTEXT.md`.
- No application code, CSS, or components touched. No build run (none required).
- Note: this report file was **appended to**, not overwritten — Part A above is the same-day Executive UX sprint that already carried the number 27.
