export interface SnapshotRequest {
  month?: string | null;
  specialty?: string | null;
  doctor?: string | null;
  drug?: string | null;
  disease?: string | null;
  riskCarrier?: string | null;
  search?: string | null;
  dayThrough?: number | null;
}

export type SnapshotCoverageDecision =
  | { status: 'cached'; month: string; reason: string }
  | { status: 'unavailable'; month: string | null; reason: string };

/**
 * The bundled snapshot contains month-level, unfiltered aggregates only.
 * It cannot safely reproduce cross-filters, searches, compare-day windows, or
 * an open-ended reporting window after newer live months have been imported.
 */
export function evaluateSnapshotCoverage(
  request: SnapshotRequest,
  coveredMonths: readonly string[],
): SnapshotCoverageDecision {
  const unsupported = [
    ['specialty', request.specialty],
    ['doctor', request.doctor],
    ['drug', request.drug],
    ['disease', request.disease],
    ['risk carrier', request.riskCarrier],
    ['search', request.search],
    ['day-through comparison', request.dayThrough],
  ].find(([, value]) => value !== null && value !== undefined && value !== '');

  if (unsupported) {
    return {
      status: 'unavailable',
      month: request.month ?? null,
      reason: `Snapshot cannot reproduce the requested ${unsupported[0]} filter.`,
    };
  }

  if (!request.month) {
    return {
      status: 'unavailable',
      month: null,
      reason: 'Snapshot coverage is partial; an explicit covered month is required.',
    };
  }

  if (!coveredMonths.includes(request.month)) {
    return {
      status: 'unavailable',
      month: request.month,
      reason: `Snapshot does not cover ${request.month}.`,
    };
  }

  return {
    status: 'cached',
    month: request.month,
    reason: `Snapshot contains unfiltered aggregates for ${request.month}.`,
  };
}
