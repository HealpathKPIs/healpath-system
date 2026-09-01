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
// empty result as NULL. Identity comparisons additionally case-fold the clean
// value, so "Mohamed Diab" and "Mohamed diab" are the same filter entity.

const ZERO_WIDTH = /[​-‍﻿]/g;
const WHITESPACE_RUN = /[\s ]+/g;

/** Clean a filter value coming from a URL/query string. Returns null if blank. */
export function normalizeFilterValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.replace(ZERO_WIDTH, '').replace(WHITESPACE_RUN, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** Case-insensitive identity key for an already human-readable filter value. */
export function normalizeFilterKey(value: string | null | undefined): string | null {
  return normalizeFilterValue(value)?.toLocaleLowerCase('en') ?? null;
}

/** Whether two filter values identify the same entity. */
export function filterValuesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizeFilterKey(left) === normalizeFilterKey(right);
}

/** Same normalization, in SQL, for a column or expression. NULL when blank. */
export function sqlNormalize(expression: string): string {
  return (
    "nullif(btrim(regexp_replace(regexp_replace(" +
    expression +
    ", '[\\u200b-\\u200d\\ufeff]', '', 'g'), '[\\s\\u00a0]+', ' ', 'g')), '')"
  );
}

/** SQL identity key matching normalizeFilterKey(). */
export function sqlNormalizeKey(expression: string): string {
  return `lower(${sqlNormalize(expression)})`;
}

// Prefer the most consistently capitalized spelling when several source rows
// differ only by case. This preserves names as entered (including Arabic and
// intentional camel-case) while choosing "Mohamed Diab" over "Mohamed diab",
// "mohamed diab", or "MOHAMED DIAB" when that spelling exists.
function displayCaseScore(value: string): number {
  return value.split(' ').reduce((score, word) => {
    if (/^\p{Lu}[^\p{Lu}]*\p{Ll}/u.test(word)) return score + 2;
    if (/^\p{Lu}{2,4}$/u.test(word)) return score + 1;
    return score;
  }, 0);
}

/** De-duplicate an already-collected list case-insensitively and sort it. */
export function normalizeFilterList(values: (string | null | undefined)[]): string[] {
  const seen = new Map<string, { value: string; score: number }>();
  for (const value of values) {
    const clean = normalizeFilterValue(value);
    const key = normalizeFilterKey(clean);
    if (!clean || !key) continue;
    const score = displayCaseScore(clean);
    const previous = seen.get(key);
    if (!previous || score > previous.score) seen.set(key, { value: clean, score });
  }
  return [...seen.values()].map(({ value }) => value).sort((a, b) => a.localeCompare(b));
}
