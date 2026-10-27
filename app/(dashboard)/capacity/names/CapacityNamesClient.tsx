'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import NameMatchRow, { type NameMatch, type Practitioner } from '@/components/capacity/NameMatchRow';

/**
 * Repair name splits that are already in the data.
 *
 * The schedule and the appointment export spell the same doctor differently, so
 * one row ends up holding the rostered hours with no bookings and another the
 * bookings with no hours. Linking them moves the stored rows onto one doctor
 * and records the spelling, so later imports resolve it without being asked
 * again.
 */
export default function CapacityNamesClient() {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<NameMatch[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/capacity/names');
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? `Could not load names (HTTP ${response.status}).`);
        return;
      }
      setConflicts(body.conflicts ?? []);
      setPractitioners(body.practitioners ?? []);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (action: 'link' | 'reject', match: NameMatch, practitionerId: number) => {
      setBusyKey(match.nameKey);
      setError(null);
      try {
        const response = await fetch('/api/capacity/names', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            aliasKey: match.nameKey,
            aliasDisplay: match.name,
            practitionerId,
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.error ?? `That did not work (HTTP ${response.status}).`);
          return;
        }
        setDone((previous) => [
          ...previous,
          action === 'link'
            ? `${match.name} joined to one doctor — ${Number(body.movedAppointments ?? 0).toLocaleString()} appointments moved.`
            : `${match.name} kept as a separate person.`,
        ]);
        await load();
        router.refresh();
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusyKey(null);
      }
    },
    [load, router],
  );

  if (loading) {
    return (
      <div className="card">
        <div className="skeleton-line" style={{ width: 220, marginBottom: 16 }} />
        <div className="skeleton-block" />
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="card" style={{ marginBottom: 20, borderColor: '#dc2626' }}>
          <p className="muted" style={{ margin: 0, color: '#dc2626' }}>{error}</p>
        </div>
      )}

      {done.map((message) => (
        <div className="card" key={message} style={{ marginBottom: 12 }}>
          <p className="muted" style={{ margin: 0 }}>✓ {message}</p>
        </div>
      ))}

      {conflicts.length === 0 ? (
        <div className="card">
          <p className="section-title">Nothing to match</p>
          <p className="muted" style={{ margin: 0 }}>
            Every doctor with bookings also has rostered time, so no names look split.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="section-title">
            {conflicts.length} {conflicts.length === 1 ? 'doctor has' : 'doctors have'} bookings but no rostered time
          </p>
          <p className="muted">
            Each of these is either the same person as someone already on the schedule, written differently, or a
            practitioner genuinely missing from it. Joining the first kind puts their hours and bookings on one row;
            leaving the second kind alone keeps the gap visible, which is the honest result.
          </p>

          {conflicts.map((match) => (
            <NameMatchRow
              key={match.nameKey}
              match={match}
              practitioners={practitioners}
              busy={busyKey === match.nameKey}
              onLink={(practitionerId) => void act('link', match, practitionerId)}
              onReject={(practitionerId) => void act('reject', match, practitionerId)}
            />
          ))}
        </div>
      )}
    </>
  );
}
