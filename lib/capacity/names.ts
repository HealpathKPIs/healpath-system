/**
 * Doctor-name matching, ported from the Capacity Analyser tool (lines 346-441).
 *
 * The schedule and the appointment export spell the same person differently
 * ("Salma Ahmed Yusuf Elshamy" vs "Salma Elshamy"), so every name is folded to a
 * key and compared token by token. nameScore returns a human-readable `why`
 * alongside the number: whoever confirms a link needs to know which kind of match
 * it is, because "shorter form of a longer name" is a far weaker claim than
 * "first and last name match".
 *
 * Keep this in step with healpath.capacity_name_key(text) in the migration — the
 * database reproduces normalizePersonName so stored rows can be re-linked in SQL.
 */

/** Fold a written name to its comparison key. Arabic characters are preserved. */
export function normalizePersonName(value: unknown): string {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[‎‏]/g, '')
    .replace(/[._\-']/g, ' ')
    .replace(/\b(prof|professor|dr|doctor|mr|mrs|ms|miss)\b\.?/g, ' ')
    .replace(/[^a-z0-9؀-ۿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Spelling variants that are the same name in practice. Transliteration from
 * Arabic is not standardised, so Mohamed/Mohammad/Muhammad must collapse before
 * any distance measure runs, or they score as different people.
 */
const FOLD: [RegExp, string][] = [
  [/^e(slam|man)$/, 'i$1'],
  [/^y[ae]ss?i?e?n$/, 'yassin'],
  [/^sh[ie]r[ie]+n$/, 'shirin'],
  [/^o?u?ss?ama$/, 'osama'],
  [/^anwe?a?r$/, 'anwar'],
  [/^s[ae]ra[h]?$/, 'sara'],
  [/^mo?ha?m+ed$|^mohammad$|^muhammad$/, 'mohamed'],
  [/^ahm[ae]d$/, 'ahmed'],
  [/^mahmo?u?d$/, 'mahmoud'],
  [/^el/, 'al'],
];

function foldToken(token: string): string {
  for (const [re, replacement] of FOLD) if (re.test(token)) return token.replace(re, replacement);
  return token;
}

const squash = (value: string) => normalizePersonName(value).replace(/ /g, '');
const foldAll = (value: string) => normalizePersonName(value).split(' ').filter(Boolean).map(foldToken);

/** Levenshtein distance over two rolling rows. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const similarity = (a: string, b: string) => {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - levenshtein(a, b) / longest : 1;
};

/** "El-" and "Al-" are the same prefix, so compare with and without it. */
const bare = (token: string) => token.replace(/^(al|el)(?=.{3,})/, '');

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const strippedA = bare(a);
  const strippedB = bare(b);
  let best = Math.max(
    similarity(a, b),
    similarity(strippedA, strippedB),
    similarity(strippedA, b),
    similarity(a, strippedB),
  );
  if (
    strippedA.length > 4 &&
    strippedB.length > 4 &&
    (strippedA.startsWith(strippedB) || strippedB.startsWith(strippedA))
  ) {
    best = Math.max(best, 0.9);
  }
  return best;
}

const tokenEquals = (a: string, b: string) =>
  a === b || (a.length > 3 && b.length > 3 && tokenSimilarity(a, b) >= 0.8);

export interface NameScore {
  /** 0-1. Compare against AUTO_LINK_THRESHOLD and SUGGEST_THRESHOLD. */
  s: number;
  /** Plain-English reason, shown to whoever confirms the link. */
  why: string;
  /** True when one name is a strict subset of the other. */
  subset?: boolean;
  /**
   * The shape that has already caused a real error here: common given names
   * with a surname only one of the two carries. Never auto-linked, whatever
   * the score, because it is exactly as likely to be two different people.
   */
  verify?: boolean;
}

export function nameScore(a: string, b: string): NameScore {
  if (normalizePersonName(a) === normalizePersonName(b)) return { s: 1, why: 'identical' };
  if (squash(a) === squash(b)) return { s: 0.99, why: 'same letters, different spacing' };

  const ta = foldAll(a);
  const tb = foldAll(b);
  if (!ta.length || !tb.length) return { s: 0, why: '' };
  if (ta.join('') === tb.join('')) return { s: 0.97, why: 'same letters after spelling variants' };

  const used = new Set<number>();
  let matched = 0;
  let exact = 0;
  for (const token of ta) {
    let bestIndex = -1;
    let best = 0;
    tb.forEach((other, index) => {
      if (used.has(index)) return;
      const value = token === other ? 1 : tokenEquals(token, other) ? tokenSimilarity(token, other) : 0;
      if (value > best) {
        best = value;
        bestIndex = index;
      }
    });
    if (best > 0) {
      used.add(bestIndex);
      matched++;
      if (best === 1) exact++;
    }
  }
  if (!matched) return { s: 0, why: '' };

  const shorter = Math.min(ta.length, tb.length);
  const letterMatch = similarity(squash(a), squash(b));
  const tie = letterMatch * 0.09;
  const firstOK = tokenEquals(ta[0], tb[0]);
  const lastOK = tokenEquals(ta[ta.length - 1], tb[tb.length - 1]);
  const spare = Math.max(ta.length, tb.length) - matched;

  if (matched >= shorter && shorter >= 2 && firstOK) {
    // Every part of the shorter name appears in the longer one. That is a real
    // match when the surname lines up, but when the longer name carries an extra
    // surname the shorter one never mentions, it can just as easily be a
    // different person who shares two common given names. Say so.
    if (spare > 0 && !lastOK) {
      return {
        s: 0.72 + tie * 0.3,
        subset: true,
        verify: true,
        why: 'shorter form of a longer name, and the surnames differ - verify',
      };
    }
    if (spare > 0) {
      return { s: 0.9 + tie * 0.3, subset: true, why: 'shorter form of a longer name; surname matches' };
    }
    return {
      s: (exact === matched ? 0.95 : 0.88) + tie * 0.3,
      why: 'all name parts match' + (exact === matched ? '' : ' allowing for spelling'),
    };
  }
  if (matched >= 2 && firstOK && lastOK) return { s: 0.85 + tie * 0.3, why: 'first and last name match' };
  if (letterMatch >= 0.8 && firstOK) return { s: 0.86 + tie * 0.3, why: 'nearly the same letters' };
  if (matched >= 2 && firstOK) return { s: 0.66 + tie, why: 'first name and one other part match' };
  if (matched >= 2) return { s: 0.52 + tie, why: 'two parts match but not the first name' };
  if (firstOK && shorter === 1) return { s: 0.48 + tie, why: 'single name matches' };
  if (firstOK) return { s: 0.36 + tie, why: 'first name matches; surname differs' };
  return { s: 0.2 + tie, why: 'weak overlap' };
}

/**
 * Auto-linking is gated on the *kind* of match, not only on its score.
 *
 * The source tool links at 0.85, which admits "first and last name match" —
 * two people sharing two common given names, over a corpus where Mohamed,
 * Mohammad and Muhammad already fold together. Crediting one doctor's hours to
 * another is what made General Surgery read 65.9% when it was really above 100%.
 *
 * 0.90 admits only near-certain spellings ("Yassien Salah" / "Yassien Sslah")
 * and subsets whose surname agrees ("Salma Ahmed Yusuf Elshamy" / "Salma
 * Elshamy"). The genuinely ambiguous shape is excluded by `verify` whatever it
 * scores, and LINK_MARGIN refuses a link when a second candidate is nearly as
 * good, which is precisely when choosing either one is a coin toss.
 */
export const AUTO_LINK_THRESHOLD = 0.9;
export const SUGGEST_THRESHOLD = 0.34;
export const LINK_MARGIN = 0.08;

/** May this match be applied without a person looking at it? */
export function canAutoLink(best: NameScore, runnerUp?: NameScore | null): boolean {
  if (best.verify) return false;
  if (best.s < AUTO_LINK_THRESHOLD) return false;
  if (runnerUp && best.s - runnerUp.s < LINK_MARGIN) return false;
  return true;
}

export interface RankedCandidate {
  key: string;
  display: string;
  s: number;
  why: string;
}

/** Best candidates for a name, strongest first, filtered to the suggest band. */
export function rankCandidates(
  name: string,
  candidates: { key: string; display: string }[],
  limit = 6,
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const score = nameScore(name, candidate.display);
      return { key: candidate.key, display: candidate.display, s: score.s, why: score.why };
    })
    .filter((candidate) => candidate.s >= SUGGEST_THRESHOLD)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
}
