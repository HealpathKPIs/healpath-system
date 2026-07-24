// RC-2 — one definition of "a clean filter value", shared by the SQL that builds
// the dropdowns and the SQL that filters on them.
//
// Why both sides must use it: the doctor list is deduplicated to "Aya Nada", but
// the visits table still stores "Aya  Nada" (two spaces) on 96 of her rows. If
// only the dropdown were normalized, selecting her would compare the clean value
// against the raw column and silently lose those visits. Every equality test on
// a filterable name therefore compares normalized-to-normalized.
//
// Normalization = drop zero-width characters, turn every whitespace run
// (including NBSP, tabs, newlines) into a single space, trim, and treat the
// empty result as NULL.

const ZERO_WIDTH = /[​-‍﻿]/g;
const WHITESPACE_RUN = /[\s ]+/g;

/** Clean a filter value coming from a URL/query string. Returns null if blank. */
export function normalizeFilterValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.replace(ZERO_WIDTH, '').replace(WHITESPACE_RUN, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** Same normalization, in SQL, for a column or expression. NULL when blank. */
export function sqlNormalize(expression: string): string {
  return (
    "nullif(btrim(regexp_replace(regexp_replace(" +
    expression +
    ", '[\\u200b-\\u200d\\ufeff]', '', 'g'), '[\\s\\u00a0]+', ' ', 'g')), '')"
  );
}

/** De-duplicate an already-collected list: normalize, drop blanks, sort. */
export function normalizeFilterList(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const clean = normalizeFilterValue(value);
    if (clean) seen.add(clean);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
