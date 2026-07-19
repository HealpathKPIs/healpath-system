// lib/chronic-normalizer.ts — the Chronic Data Normalization layer (Sprint 35).
//
// ALL normalization logic lives here. The import route runs every parsed row
// through normalizeChronicRow() BEFORE anything is written to Supabase, so the
// database only ever stores normalized values. The import page may CALL these
// functions to display the report, but contains no normalization logic itself.
//
// The pipeline is generic (createNormalizer) so the same infrastructure serves
// Issues today and Recommendations / Consultants / Medication Names / Diagnoses
// tomorrow — each future entity only needs a canonical list and mapping rules.

export type ChronicNormalizationReason = 'exact' | 'mapped' | 'normalized' | 'unknown';

export interface ChronicNormalizationResult {
  value: string;
  reason: ChronicNormalizationReason;
  changed: boolean;
}

export interface ChronicNormalizationChange {
  field: string;
  original: string;
  normalized: string;
  reason: ChronicNormalizationReason;
}

export interface ChronicNormalizationReport {
  rows: number;
  normalized: number;
  mapped: number;
  unknown: number;
}

export interface ChronicNormalizationLogEntry {
  field: string;
  original: string;
  normalized: string;
  reason: ChronicNormalizationReason;
  occurrences: number;
}

// ── Normalization key ────────────────────────────────────────────────────────
// trim → strip surrounding quotes → lowercase → drop a leading "Issue N" label
// → fold ':' ';' ',' '-' '_' to spaces → drop other/duplicated punctuation →
// collapse multiple spaces. Used only for matching; never displayed or stored.
export function chronicNormalizationKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .toLowerCase()
    .replace(/^\s*issue\s*\d+\s*[:;,\-_.]*\s*/, '')
    .replace(/[:;,\-_]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance (single-row iterative) → similarity ratio in [0, 1].
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - editDistance(a, b) / longest : 1;
}

export interface ChronicNormalizerConfig {
  /** Official categories — matched values are stored with EXACTLY this spelling. */
  canonical: readonly string[];
  /** Explicit mapping rules: raw spelling → official category. Keys may be any spelling; they are normalized internally. */
  mappings?: Record<string, string>;
  /** Fuzzy-match acceptance threshold (default 0.9 = 90%). */
  threshold?: number;
}

/**
 * Build a normalizer. Resolution order per value:
 *  1. explicit mapping rule            → reason 'mapped'
 *  2. exact/fuzzy (≥ threshold) match  → canonical spelling, reason 'normalized'
 *     (or 'exact' when the value already IS the canonical spelling)
 *  3. no match                         → keep original; reason 'unknown' when a
 *     canonical list exists, 'exact' when the entity has no official list yet
 *     (accept-as-is infrastructure mode, e.g. Recommendations today).
 */
export function createChronicNormalizer(config: ChronicNormalizerConfig) {
  const threshold = config.threshold ?? 0.9;
  const canonical = [...config.canonical];
  const canonicalKeys = canonical.map(chronicNormalizationKey);
  const mappingByKey = new Map<string, string>(
    Object.entries(config.mappings ?? {}).map(([from, to]) => [chronicNormalizationKey(from), to]),
  );
  const cache = new Map<string, ChronicNormalizationResult>();

  return function normalize(raw: string): ChronicNormalizationResult {
    const trimmed = raw.trim();
    if (!trimmed) return { value: trimmed, reason: 'exact', changed: false };
    const cached = cache.get(trimmed);
    if (cached) return cached;

    const key = chronicNormalizationKey(trimmed);
    let result: ChronicNormalizationResult;

    const mapped = key ? mappingByKey.get(key) : undefined;
    if (mapped !== undefined) {
      result = { value: mapped, reason: 'mapped', changed: mapped !== trimmed };
    } else if (canonical.length && key) {
      let best = -1;
      let bestScore = 0;
      for (let i = 0; i < canonicalKeys.length; i += 1) {
        const score = similarity(key, canonicalKeys[i]);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best >= 0 && bestScore >= threshold) {
        const value = canonical[best];
        result = value === trimmed
          ? { value, reason: 'exact', changed: false }
          : { value, reason: 'normalized', changed: true };
      } else {
        result = { value: trimmed, reason: 'unknown', changed: false };
      }
    } else {
      // Infrastructure mode: no official list yet — accept trimmed value as-is.
      result = { value: trimmed, reason: canonical.length === 0 ? 'exact' : 'unknown', changed: false };
    }

    cache.set(trimmed, result);
    return result;
  };
}

// ── Issues: the 13 official categories ───────────────────────────────────────
export const CHRONIC_CANONICAL_ISSUES = [
  '0',
  'Acc. to DAPT score',
  'Acc to FRAX score',
  'Acc to MMSE score',
  'Cannot be taken as chronic',
  'Contraindicated with',
  'Dose is decreased for long time use',
  'exaggerated protocol',
  'Mild interaction',
  'Moderate interaction',
  'Not related to the diagnosis',
  'Severe interaction',
  'To be re-considered if the patient still needs it or not',
] as const;

export const CHRONIC_ISSUE_MAPPINGS: Record<string, string> = {
  'No Chronic Found': 'Cannot be taken as chronic',
  'NO NEED FOR CHRONIC': 'Cannot be taken as chronic',
  'Not related to diagnosis': 'Not related to the diagnosis',
  'moderate': 'Moderate interaction',
  'Moderate interactionue': 'Moderate interaction',
  'As is': '0',
  're': '0',
  '1': '0',
};

export const normalizeChronicIssueValue = createChronicNormalizer({
  canonical: CHRONIC_CANONICAL_ISSUES,
  mappings: CHRONIC_ISSUE_MAPPINGS,
});

// ── Recommendations: infrastructure only (no official list / mappings yet) ──
export const normalizeChronicRecommendationValue = createChronicNormalizer({
  canonical: [],
  mappings: {},
});

// ── Row normalization ────────────────────────────────────────────────────────

function isIssueFieldKey(key: string) {
  return /^issue\s*[\-_.]?\s*\d+/i.test(key.trim()) || /^issue\d+/i.test(key.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
}

interface NormalizableChronicRow {
  recommendation: string;
  issue: string | null;
  row_data: Record<string, unknown>;
}

/**
 * Normalize ONE parsed row in place, BEFORE insert:
 *  - every `Issue 1..N` field inside row_data (values, not headers),
 *  - the `issue` summary column (rebuilt from the normalized fields so the two
 *    can never disagree),
 *  - the recommendation (infrastructure passthrough today).
 * Returns the individual value changes for reporting/logging.
 */
export function normalizeChronicRow(row: NormalizableChronicRow): ChronicNormalizationChange[] {
  const changes: ChronicNormalizationChange[] = [];
  const issueParts: string[] = [];

  for (const key of Object.keys(row.row_data)) {
    if (!isIssueFieldKey(key)) continue;
    const rawValue = row.row_data[key];
    const original = String(rawValue ?? '').trim();
    if (!original) continue;
    const result = normalizeChronicIssueValue(original);
    if (result.value !== original) {
      row.row_data[key] = result.value;
    }
    issueParts.push(`${key}: ${result.value}`);
    if (result.reason !== 'exact') {
      changes.push({ field: 'issue', original, normalized: result.value, reason: result.reason });
    }
  }

  // Rebuild the issue summary column from the (now normalized) issue fields.
  row.issue = issueParts.length ? issueParts.join('; ') : null;

  const recommendation = String(row.recommendation ?? '').trim();
  if (recommendation) {
    const result = normalizeChronicRecommendationValue(recommendation);
    if (result.value !== recommendation) row.recommendation = result.value;
    if (result.reason !== 'exact') {
      changes.push({ field: 'recommendation', original: recommendation, normalized: result.value, reason: result.reason });
    }
  }

  return changes;
}

/** Normalize every row (in place) and produce the import report + log entries. */
export function normalizeChronicRows(rows: NormalizableChronicRow[]) {
  const changes: ChronicNormalizationChange[] = [];
  for (const row of rows) changes.push(...normalizeChronicRow(row));
  return {
    report: summarizeChronicNormalization(rows.length, changes),
    log: aggregateChronicNormalizationLog(changes),
    changes,
  };
}

/** Rows / Normalized / Mapped / Unknown — the numbers shown after Validate. */
export function summarizeChronicNormalization(rows: number, changes: ChronicNormalizationChange[]): ChronicNormalizationReport {
  let normalized = 0;
  let mapped = 0;
  let unknown = 0;
  for (const change of changes) {
    if (change.reason === 'mapped') mapped += 1;
    else if (change.reason === 'normalized') normalized += 1;
    else if (change.reason === 'unknown') unknown += 1;
  }
  return { rows, normalized, mapped, unknown };
}

/** Distinct Original → Normalized (+ reason) pairs with occurrence counts. */
export function aggregateChronicNormalizationLog(changes: ChronicNormalizationChange[]): ChronicNormalizationLogEntry[] {
  const entries = new Map<string, ChronicNormalizationLogEntry>();
  for (const change of changes) {
    const key = `${change.field} ${change.original} ${change.normalized} ${change.reason}`;
    const entry = entries.get(key);
    if (entry) entry.occurrences += 1;
    else entries.set(key, { ...change, occurrences: 1 });
  }
  return Array.from(entries.values()).sort((a, b) => b.occurrences - a.occurrences || a.original.localeCompare(b.original));
}
