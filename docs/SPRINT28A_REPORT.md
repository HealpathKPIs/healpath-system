# Sprint 28A — Theme System (Dark Mode fix)

**Date:** 2026-07-10
**Objective:** Make the existing Light/Dark/System selector actually work — a persisted, system-aware dark theme covering every page, card, nav, drawer, filter, dialog, table, and chart. Reuse the existing CSS variables; no layout redesign, no business-logic/API changes.
**Result:** ✅ Dark mode works end-to-end in **6 files** (the sprint cap). The theme is variable-driven, so one token block themes the whole app.

---

## Root cause

The Settings selector already **persisted** `appearance` to `hp-settings`, but nothing consumed it and there were no dark tokens — so dark mode never rendered (the Settings note even admitted "Dark applies once dark tokens land"). Two things were missing: **dark CSS tokens** and a **theme applier**.

## What was built

1. **`app/globals.css`** — added a `html[data-theme="dark"]` block that remaps **every design token** (surfaces, text, borders, accent family, semantic tones, **chart palette**, shadows, `color-scheme`), plus scoped overrides for the handful of rules that hardcoded a light color (body gradient, `.navlink`, `.navlink.active`, `.filters`, select/search icons, `td`, `tbody tr:hover`, skeletons, scrollbars, `.loginbox`). Because the whole app already draws from these variables, this one block themes all class-based UI **and** every component that styles inline with `var(--…)` (Compare drawer, Command Palette, Settings, Import, KPI cards, tables, charts’ grid/axis/tracks). Chart series were lifted for dark contrast (`--meds #818cf8`, `--labs/-–success #34d399`, `--scans #60a5fa`, `--danger #fb7185`, `--warning #fbbf24`).
2. **`components/ThemeManager.tsx`** (new, client, renders nothing) — reads `hp-settings.appearance` and sets `<html data-theme="light|dark">`. Reacts to: the Settings live event `healpath:settings-changed`, cross-tab `storage`, and — in **System** mode — the OS `matchMedia('(prefers-color-scheme: dark)')` change.
3. **`app/layout.tsx`** — mounts `<ThemeManager/>` and adds an **inline no-flash `<head>` script** that applies the persisted theme *before first paint* (`<html suppressHydrationWarning>`), so there is no light→dark flash on load.
4. **`app/settings/page.tsx`** — `update()` now dispatches `healpath:settings-changed` so Appearance changes apply **instantly** (same tab); corrected the stale "ships a light palette" note.
5. **`app/page.tsx`** — Overview insight cards (Executive Alerts / Movers / Smart Comparison / Executive Summary) had inline hardcoded white/tinted gradients and dark semantic text; swapped to variables. Semantic alert tints are now theme-adaptive via `color-mix(in srgb, var(--danger|warning|success) 16%, var(--surface))`.
6. **`components/ExecutiveExperience.tsx`** — Executive Feed cards, the Explain button/popover, and the scenario status pill de-hardcoded (`#fff`/`#f8fafc`/hex → `var(--surface)`/`var(--success|danger|text-muted)`).

No layouts changed, no business logic, no API changes.

## Verification (once)

Build: ✅ EXIT 0, "Compiled successfully", 19/19 routes.

Browser (`localhost:3000`, driven via DOM):

| Check | Result |
|---|---|
| Choose **Dark** (writes `hp-settings` + fires live event) | `<html data-theme>` → **dark**; `--surface` #ffffff→**#151c28**, `--bg`→#0b0f17, card text → light (#e6eaf2) |
| Choose **Light** | back to `data-theme="light"`, `--surface` #ffffff |
| Choose **System** | follows OS (`prefers-color-scheme: dark = false` → light) |
| **No-flash** | reload with dark persisted → `data-theme="dark"` **on load**; the inline script is present in the server HTML `<head>` |
| **Tables** (/diseases) | table/`th`/`td` dark surfaces, `td` text light (#c3ccda) |
| **Filters / Search** | `.filters` rgba(21,28,40,.7), search input dark |
| **Dialog** (Command Palette) | panel + input dark (rgb 21,28,40), text light |
| **Cards / Nav / KPIs / Feed** | all dark surfaces; Overview insight + Executive Feed cards no longer white |

User preference restored to **System** after testing (session not left forced dark).

## Known residual (documented, not shipped as a hack)

Two **transient** popovers still render a light surface in dark mode because they set an inline hex that CSS variables can't reach and an attribute-selector override is unreliable for client-set styles: the **`SearchBox` autocomplete dropdown** (`#fff`) and the **`Donut` hover tooltip** (`#ffffff`). Fixing them is a one-line change in each file, deferred only to respect the **6-file cap** on this sprint. The chart *bodies* (bars, trend lines/grid/axis, donut segments) theme correctly; only the donut’s hover tooltip is affected. Recommended as a tiny **Sprint 28B** follow-up.

## Guidance for future work
Everything themes **because it uses the CSS variables**. New UI must use `var(--surface|text|border|accent|…)` — hardcoded hex colors will not respond to the theme.
