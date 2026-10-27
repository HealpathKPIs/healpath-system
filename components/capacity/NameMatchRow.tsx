'use client';

import { useState } from 'react';

/**
 * One doctor name awaiting a decision, with the candidates it resembles.
 *
 * The score alone is not enough to decide on, so the reason is always shown.
 * "shorter form of a longer name; surname matches" is a far stronger claim
 * than "first name matches; surname differs", and the second is exactly the
 * shape that put one doctor's hours against another's name.
 */

export interface NameCandidate {
  practitionerId: number;
  display: string;
  score: number;
  why: string;
  verify: boolean;
  auto: boolean;
}

export interface NameMatch {
  name: string;
  nameKey: string;
  practitionerId: number | null;
  status: 'known' | 'auto' | 'review' | 'new';
  candidates: NameCandidate[];
  appointments?: number;
  shifts?: number;
}

export interface Practitioner {
  id: number;
  display: string;
  rosteredMinutes: number;
}

const button: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  borderRadius: 8,
  padding: '5px 11px',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};
const primary: React.CSSProperties = { ...button, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };

export default function NameMatchRow({
  match,
  practitioners,
  busy,
  onLink,
  onReject,
}: {
  match: NameMatch;
  practitioners: Practitioner[];
  busy: boolean;
  onLink: (practitionerId: number) => void;
  onReject: (practitionerId: number) => void;
}) {
  const [picked, setPicked] = useState<number | ''>('');
  const best = match.candidates[0];

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 14,
        marginTop: 14,
        opacity: busy ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{match.name}</strong>
        {typeof match.appointments === 'number' && (
          <span className="muted" style={{ fontSize: 13 }}>
            {match.appointments.toLocaleString()} appointments · {match.shifts ?? 0} shifts
          </span>
        )}
      </div>

      {!best && (
        <p className="muted" style={{ marginTop: 6, marginBottom: 8 }}>
          No one on the schedule resembles this name. They are most likely missing from the roster rather than
          misspelled.
        </p>
      )}

      {best && (
        <p className="muted" style={{ marginTop: 6, marginBottom: 8 }}>
          Closest match <strong>{best.display}</strong> — {Math.round(best.score * 100)}%, {best.why}.
          {best.verify && (
            <span style={{ color: '#b45309' }}>
              {' '}This is the shape that is easy to get wrong: two people can share given names and differ only in a
              surname one of them never writes. Check before joining them.
            </span>
          )}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {best && (
          <>
            <button type="button" style={primary} disabled={busy} onClick={() => onLink(best.practitionerId)}>
              Same person as {best.display}
            </button>
            <button type="button" style={button} disabled={busy} onClick={() => onReject(best.practitionerId)}>
              Different person
            </button>
          </>
        )}

        <select
          value={picked}
          disabled={busy}
          onChange={(event) => setPicked(event.target.value ? Number(event.target.value) : '')}
          style={{ ...button, cursor: 'default', minWidth: 210 }}
        >
          <option value="">Link to someone else…</option>
          {practitioners
            .filter((person) => person.id !== match.practitionerId)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.display}
                {person.rosteredMinutes > 0 ? ` (${(person.rosteredMinutes / 60).toFixed(0)} h)` : ''}
              </option>
            ))}
        </select>
        {picked !== '' && (
          <button type="button" style={primary} disabled={busy} onClick={() => onLink(Number(picked))}>
            Link
          </button>
        )}
      </div>

      {match.candidates.length > 1 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
            Other possibilities ({match.candidates.length - 1})
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {match.candidates.slice(1).map((candidate) => (
              <li key={candidate.practitionerId} className="muted" style={{ fontSize: 13, marginBottom: 3 }}>
                {candidate.display} — {Math.round(candidate.score * 100)}%, {candidate.why}{' '}
                <button
                  type="button"
                  style={{ ...button, padding: '2px 8px', fontSize: 12 }}
                  disabled={busy}
                  onClick={() => onLink(candidate.practitionerId)}
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
