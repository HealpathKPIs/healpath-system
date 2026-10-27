/**
 * Specialty grouping, ported from the Capacity Analyser tool (lines 496-548).
 *
 * The schedule writes sub-specialties as "Internal & ICU", "Internal &GIT",
 * "Internal &Endocrine". They roll up under the part before "&", matched without
 * regard to case or spacing against a specialty that already exists. A choice
 * recorded in the database overrides that.
 *
 * Only "&" is read as a split: "/" and the word "and" appear inside single
 * specialty names (Ob/Gyn, Obstetrics and Gynecology) and splitting on them
 * would invent parents that do not exist.
 */

export const UNASSIGNED = 'Unassigned';

/** Compare specialty names ignoring case and runs of whitespace. */
export const specialtyFold = (value: unknown) =>
  String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A stored decision about one specialty.
 *
 * `parent` is tri-state and collapsing it loses information:
 *   - not present in the map  -> follow the automatic rule
 *   - present with null       -> stands alone, suppressing the automatic rule
 *   - present with a name     -> rolls up under that specialty
 *
 * Treating "absent" and "stands alone" as the same value silently re-enables
 * auto-grouping on every specialty somebody deliberately detached.
 */
export interface SpecialtyConfig {
  /** Every specialty currently in use or declared, excluding hidden ones. */
  known: string[];
  /** Explicit decisions, keyed by specialty name. */
  overrides: Map<string, string | null>;
}

export const emptySpecialtyConfig = (): SpecialtyConfig => ({ known: [], overrides: new Map() });

/**
 * The parent the automatic rule would pick, or null when the name carries no
 * "&" and therefore stands on its own.
 */
export function suggestParentSpecialty(name: unknown, known: string[]): string | null {
  const match = String(name == null ? '' : name).match(/^\s*([^&]+?)\s*&\s*\S/);
  if (!match) return null;
  const head = match[1].replace(/\s+/g, ' ').trim();
  const existing = known.find((candidate) => specialtyFold(candidate) === specialtyFold(head));
  return existing || head;
}

/**
 * Resolve a specialty to the one it reports under.
 *
 * Walks at most four hops with a seen-set, so a mapping somebody has made
 * circular (A -> B -> A) terminates instead of hanging the render.
 */
export function resolveMainSpecialty(name: string | null | undefined, config: SpecialtyConfig): string {
  if (!name || name === UNASSIGNED) return name || UNASSIGNED;
  let current = name;
  const seen = new Set<string>();
  for (let hop = 0; hop < 4 && !seen.has(current); hop++) {
    seen.add(current);
    let next: string;
    if (config.overrides.has(current)) {
      next = config.overrides.get(current) ?? current;
    } else {
      next = suggestParentSpecialty(current, config.known) ?? current;
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

export type SpecialtyLevel = 'group' | 'sub';

/** The key a row is reported under at the chosen level. */
export function specialtyKey(
  name: string | null | undefined,
  config: SpecialtyConfig,
  level: SpecialtyLevel,
): string {
  if (level === 'sub') return name || UNASSIGNED;
  return resolveMainSpecialty(name || UNASSIGNED, config);
}

/**
 * Does a row's specialty satisfy a filter value?
 *
 * Matches the name itself or its parent, so filtering on "Internal Medicine"
 * also catches "Internal & ICU". Plain string equality here would silently drop
 * most of the sub-specialty rows.
 */
export function specialtyMatches(
  name: string | null | undefined,
  want: string,
  config: SpecialtyConfig,
): boolean {
  const target = specialtyFold(want);
  return specialtyFold(name) === target || specialtyFold(resolveMainSpecialty(name, config)) === target;
}
