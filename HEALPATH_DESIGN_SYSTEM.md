# HealPath Design System

**Version 1.0 · 2026-07-09**
The single reference for how HealPath looks, moves, and behaves. Tokens below document the shipped system (`app/globals.css` + component conventions). Reference tokens — never inline hex — in future work.

---

## 1. Brand Philosophy

HealPath is an **executive clinical intelligence** surface. Every screen answers one question fast: *what is happening in this health system right now?*

| Trait | What it means in the UI |
|---|---|
| **Executive** | The first row of every page is a decision-ready number, not navigation or chrome. |
| **Clinical** | Calm, precise, unemotional. No decoration that could be mistaken for data. |
| **Premium** | Layered soft surfaces, hairline borders, restrained shadows — quality read at a glance. |
| **Minimal** | One accent color. One typeface. If an element doesn't carry information or action, it doesn't ship. |
| **Fast** | Motion under 250ms, skeletons over spinners, counts that resolve — perceived speed is a feature. |
| **Trustworthy** | Numbers are exact, tabular, and traceable to the reporting window. Unavailable data is hidden, never fabricated. |
| **Data-first** | Color belongs to data series before it belongs to brand. Charts get the palette; chrome stays neutral. |

**The signature:** a near-white layered canvas, a single indigo action color, heavy tight-tracked numerals against quiet muted labels. Depth comes from surface layering and soft elevation — never from heavy borders or saturation.

---

## 2. Color Tokens

All colors live as CSS custom properties. Chrome is neutral; saturation is reserved for actions, states, and data.

### Action
| Token | Value | Role |
|---|---|---|
| `--accent` (Primary) | `#6366f1` | The single primary action color: active nav, focus, selection, primary buttons, brand mark |
| `--accent-strong` | `#4f46e5` | Pressed/gradient-end of primary |
| `--accent-ink` | `#3730a3` | Primary-tinted text (eyebrows, active labels) |
| `--accent-soft` (Secondary) | `#eef0ff` | Tinted fills behind active/selected chrome |
| `--accent-border` | `#dfe1ff` | Border of accent-tinted chrome |

### State
| Token | Value | Role |
|---|---|---|
| `--success` | `#059669` | Positive deltas, "Connected", completed imports (`--success-soft #ecfdf5` fill) |
| `--warning` | `#d97706` | Cautionary insights, skipped-row notices |
| `--danger` | `#e11d48` | Negative deltas, failures, destructive states (`--danger-soft #fef2f4` fill) |
| Info | `#2563eb` | Informational tone (shared with the scans series) |

### Surface & Background
| Token | Value | Role |
|---|---|---|
| `--bg` (Background) | `#f5f6f8` | Page canvas, with a fixed radial indigo/emerald wash at the top |
| `--bg-soft` | `#eef1f5` | Soft canvas variant |
| `--surface` (Card) | `#ffffff` | Cards, tables, panels, drawers |
| `--surface-2` | `#f8fafc` | Nested chrome: inputs, hover rows, segmented controls |
| `--surface-3` | `#f1f4f9` | Deepest inset: track fills, flat pills |

### Border
| Token | Value | Role |
|---|---|---|
| `--border` | `#e7e9ee` | Default 1px hairline everywhere |
| `--border-soft` | `#eef0f4` | Row separators inside cards |
| `--border-strong` | `#d7dbe3` | Hover borders, dashed empty-state outlines |

### Text
`--text-strong #060c18` (display/KPI) · `--text #0f172a` (default) · `--text-muted #64748b` (labels) · `--text-soft #94a3b8` (captions, placeholders).

### Charts
Data owns the saturated palette; series colors are stable across every page:

| Series | Value |
|---|---|
| Medications (`--meds`) | `#6366f1` |
| Laboratories (`--labs`) | `#10b981` |
| Scans (`--scans`) | `#2563eb` |
| Categorical (donut) | `#635bff · #16a36f · #2563eb · #d97706 · #d92d20 · #db2777 · #0d9488 · #ea580c · #64748b · #65a30d` |

**Rules:** one primary action color — never introduce a second brand hue. State colors appear only with a state. A series color means that series, everywhere.

---

## 3. Typography

One family — **Inter** (`ui-sans-serif` fallback stack) — with hierarchy built from weight + tracking contrast: heavy, tightly-tracked numerals and headings against quiet 500-weight labels.

| Token | Spec | Use |
|---|---|---|
| **Display** | clamp(30–44px) / 740 / −0.038em / lh 1.02 | Overview title |
| **Heading** | clamp(24–32px) / 700 / −0.03em / lh 1.05 | Page titles |
| **Title** | 14px / 650 / −0.015em, with a 6×16px accent tick | Section titles (`.section-title`) |
| **Body** | 14px / 400–500 / −0.006em / lh 1.5 | Default text, table cells (13px) |
| **Caption** | 11–12px / 550–700; uppercase labels at +.05–.08em tracking | Micro-labels, hints, badges, table headers |
| **Numbers** | `font-variant-numeric: tabular-nums` — mandatory for every numeric column, delta, and counter | All data numerals |
| **KPI** | clamp(28–40px) / 720–780 / −0.035em / lh 1 / tabular | KPI card values |

**Rules:** negative tracking scales with size (bigger = tighter); uppercase is reserved for micro-labels and always letter-spaced; no second typeface, no italic; KPI numerals are the loudest element on any page — nothing may out-weigh them.

---

## 4. Spacing

8px-base scale. Density is executive-tight, not marketing-airy.

| Step | Use |
|---|---|
| **4** | Icon↔text gaps, chip padding tweaks |
| **8** | Intra-control gaps, chip rows, small stacks |
| **12** | Compact card grids (Overview KPI band), panel row gaps |
| **16** | Card internal micro-sections, drawer element gaps |
| **24** | Card padding (22–24px), panel padding |
| **32** | Page top padding, header→content break |
| **48** | Page horizontal padding at wide viewports (clamp 20→56) |
| **64** | Page bottom padding |
| **80** | Reserved: hero/major band rhythm for future marketing surfaces |

Grid gaps: 20px between cards; 12–14px inside dense bands. Max content width 1440–1480px, centered; Overview report column 1240px.

---

## 5. Border Radius

Soft-geometry dialect — rounded, never bubbly.

| Element | Radius |
|---|---|
| **Cards** | 12px (`--r-md`); insight sub-cards 12–14px |
| **Buttons** | 9–10px; segmented-control inners 7px |
| **Inputs / selects / search** | 10px |
| **Drawer / floating panels** | 14–16px (Compare drawer 16, scenario panel 14) |
| **Dialog (Command Palette)** | 16px |
| Pills, dots, toggles, tracks | 999px (`--r-pill`) |

Rule: chrome never exceeds 16px radius; only pills are fully round.

---

## 6. Elevation

Layered, soft, low-alpha slate shadows — always paired with a hairline border. Elevation states intent, not decoration.

| Level | Token | Use |
|---|---|---|
| **Card** | `--shadow-xs` / `--shadow-sm` (`0 1px 2px rgba(15,23,42,.05–.06)` + soft second layer) | Resting cards, tables, inputs |
| **Hover** | `--shadow-md` (`0 4px 12px …06` + `0 2px 6px …04`) + `--border-strong`; KPI cards add `translateY(-2px)` | Interactive lift |
| **Drawer** | `--shadow-lg` (`0 24px 60px …12` + `0 4px 14px …06`) | Compare drawer, floating scenario panel |
| **Modal** | `--shadow-lg` over a `rgba(15,23,42,.30)` backdrop with 4–5px blur | Command Palette |
| Focus | `--ring` (`0 0 0 4px rgba(99,102,241,.14)`) | Focused inputs/controls |

Rule: shadows never darken past 12% alpha; a shadow without a border is off-system.

---

## 7. Motion

Motion is confirmation, not spectacle. Everything respects `prefers-reduced-motion`.

| Pattern | Duration | Easing | Behavior |
|---|---|---|---|
| **Page Transition** | 210ms | `cubic-bezier(0.16,1,0.3,1)` | Fade + 8px rise, keyed on pathname only (never on filter changes) |
| **Card Hover** | 200ms | ease | Shadow/border lift; KPI −2px translate |
| **Drawer Slide** | 160–200ms | `cubic-bezier(0.16,1,0.3,1)` | Compare: 24px slide-in; Palette: −10px drop + 0.985 scale; Scenario: 10px rise |
| **Counter Animation** | 600ms | ease-out (cubic) | KPI count-up 0→value; re-animates only when the value changes; always settles exact |
| **Chart Animation** | 500ms | `cubic-bezier(0.4,0,0.2,1)` | Rank-bar width fill; skeleton shimmer 1.5s loop |
| Micro (toggles, chips) | 120–160ms | ease | Background/color/transform |

**Duration bands:** micro ≤160ms · structural 180–250ms · data emphasis ≤700ms. Nothing loops except skeletons; no bounce, no zoom.

---

## 8. Component Rules

| Component | Rules |
|---|---|
| **KPI Cards** | Uppercase muted micro-label; huge tabular value (animated count-up); optional delta pill (▲ success / ▼ danger / ■ flat, tinted soft fill). Overview variant: 3px left tone bar + top-right radial wash in the metric's tone. Hover lifts. |
| **Charts** | Series colors fixed (§2). Rank bars: label + tabular value over a 999px track, gradient fill, min-width 4%. Trend: dashed grid, gradient area fills, 3.5px white-stroked dots, chip legend. Donut: 2° pad angle, white tooltip card. Clickable marks set the global selection (`aria-pressed` + `data-selected`). |
| **Executive Feed** | Max 5 insight rows; icon + one muted sentence; each row opens a scenario. Hidden entirely when the Settings toggle is off. |
| **Executive Scenario** | Compact floating panel, bottom-right (350px, ≤58vh), non-modal, no backdrop. Shows only while an entity is selected; ✕ clears the selection everywhere (context + URL). |
| **Compare Center** | Right drawer ≤500px, portaled to `<body>`. Segmented type switch; Left/Right selects; stacked metric cards (`value vs value` + ▲/▼/≈ delta chip). Unavailable metrics are hidden — never fabricated. Quick actions reuse existing routes/filters. |
| **Import Center** | Dashed 2px drop-zone (accent tint on drag); staged flow: ✔ loaded → preview (no write) → gradient primary button → progress bar + per-table status → success summary + duration → Refresh. Warnings in `--warning`. |
| **Command Palette** | 620px dialog at 12vh, blurred backdrop, 16px radius. Debounced ≥2-char search, ≤8 mixed-scope results: icon + title + uppercase category badge. ↑↓ Enter Esc; selection navigates via existing `?q=` filters. |
| **Tables** | Sticky uppercase 11.5px headers on `--surface-2`; 13px rows; `--border-soft` separators; hover tint `#f7f8ff`; numeric columns right-aligned tabular; sortable headers show ASC/DESC. |
| **Filters** | One pill-shaped cluster (12px radius, blurred white) of borderless selects with chevrons; hover `--surface-2`, focus ring. State lives in the URL — always shareable. |
| **Search** | 40px input, 10px radius, inline magnifier icon, focus ring. Debounce 300ms, min 2 chars, `<mark>` highlight (accent 20% fill), full keyboard nav. One SearchBox component everywhere. |
| **Settings** | Stacked cards per section; label-left/control-right rows split by `--border-soft`; 40×22px accent toggles; segmented choices; honest placeholders for unbuilt features. |
| **Upload History** | Compact table (Date · File · Status · Rows · Duration), latest 10, status colored success/danger, filenames ellipsized, explicit empty state. |

---

## 9. Dashboard Rules

- **Maximum cards per row:** 5 (Overview KPI band); 4 for standard KPI rows; reflow 5→auto→2→1 down the breakpoints.
- **Maximum charts per section:** 2 side-by-side (`.two` / `.lead`); a full-width chart stands alone. Never 3-up charts.
- **Whitespace:** 20px between cards, 22–24px inside them; page gutter clamp(20→56px); sections separated by rhythm, not divider lines.
- **Titles:** every card opens with one `.section-title` (accent tick + 14/650). Page header = eyebrow (optional) + title + subtitle, bottom-ruled. No untitled cards.
- **Actions:** primary action = accent gradient fill; everything else = quiet bordered white buttons. One primary action per view. Global actions (⚖ Compare, Search) live beside the filters/nav, never inside data cards.
- **Hierarchy:** insights → KPI band → paired visuals → full-width trend → tables. Numbers before charts, charts before tables; drill-down always flows downward.

---

## 10. Interaction Rules

| State | Treatment |
|---|---|
| **Hover** | Border → `--border-strong`, shadow → md, row tint; pointer cursor only on truly interactive elements |
| **Focus** | `--ring` + `--accent-border`; never remove outlines without replacing them |
| **Selection** | Single global selection: accent-soft fill + `--accent-border` + `aria-pressed="true"`; re-click clears; ✕ affordances always visible |
| **Loading** | Route-level skeletons mirroring the target layout; determinate progress bars for imports; "Comparing…"-style quiet placeholders inside panels. No full-screen spinners |
| **Skeleton** | `--surface` cards with shimmering lines/blocks (1.5s loop), matching final geometry |
| **Empty State** | Dashed `--border-strong` outline, striped `--surface-2` fill, one muted sentence ("No data for the selected filters"). Never a blank void |
| **Success** | ✔ + `--success` text on `--success-soft`; confirmation stays in place (no toasts yet — see §12) |
| **Error** | `--danger` text on `--danger-soft`, message verbatim and actionable; failed rows/steps named, never silently dropped |

---

## 11. Accessibility

- **Contrast:** body/display text ≥ 7:1 on white; muted text reserved for ≥12px secondary content (≥4.5:1); state colors chosen to pass 4.5:1 on their soft fills; data never encoded by color alone (labels + values always present).
- **Keyboard:** everything reachable — clickable chart rows are `role="button"` + `tabIndex` + Enter/Space; palette and search have full arrow/Enter/Esc loops; drawers close on Esc; toggles are `role="switch"`.
- **Focus Ring:** the 4px soft accent `--ring` is the universal focus signal, on light or tinted surfaces alike.
- **Reduced Motion:** every keyframe (page enter, drawers, palette, scenario, counters) collapses to instant under `prefers-reduced-motion: reduce`; counters snap to final values.
- ARIA: dialogs are `role="dialog" aria-modal` with labels; comboboxes/listboxes/options annotated; pressed/selected states mirrored in `aria-pressed`/`aria-selected`.

---

## 12. Future Components (placeholders)

Reserved names and slots — to be specified when built, inheriting every token above:

| Component | Reserved intent |
|---|---|
| **Notification Center** | Bell entry in the sidebar; right panel reusing drawer tokens (§5/§6); severity via state colors; replaces in-place confirmations where global visibility is needed |
| **AI Assistant** | Conversational layer over the deterministic insight engine; palette-style invocation; must cite the queries behind every claim — no unexplained numbers |
| **Alerts** | Threshold rules on KPIs (e.g. meds/visit > target); authored in Settings; surfaced via Notification Center + Executive Alert bar |
| **Forecast** | Projected trend segments rendered dashed in series colors at 60% opacity; clearly separated from actuals; never mixed into KPI counts |
| **Compare** *(extension)* | Multi-entity (3+) comparison, specialty-vs-specialty, and export — building on the Compare Center drawer |
| **Import Wizard** | Multi-step guided import: column mapping, validation preview, idempotency/duplicate guard, scheduling — succeeding the single-screen Import Center |

---

*Documentation only — this file changes no code. When implementation and this document disagree, fix one of them in the same sprint.*
