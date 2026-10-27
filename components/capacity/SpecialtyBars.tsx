'use client';

/**
 * Utilisation by specialty.
 *
 * The job is comparing magnitude, so this is one hue at varying strength rather
 * than a different colour per specialty. Giving each specialty its own hue
 * would claim they are identities to be told apart, bury the one row that
 * matters, and run out of distinguishable colours by the eighth row.
 */

export interface SpecialtyBar {
  label: string;
  value: number | null;
  rosteredMinutes: number;
  doctors: number;
}

export default function SpecialtyBars({ rows, max = 100 }: { rows: SpecialtyBar[]; max?: number }) {
  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>No specialties in this range.</p>;

  const ceiling = Math.max(max, ...rows.map((row) => row.value ?? 0));
  const strongest = Math.max(...rows.map((row) => row.value ?? 0)) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((row) => {
        const value = row.value ?? 0;
        // More-is-darker within one hue: opacity carries magnitude, never identity.
        const strength = 0.4 + 0.6 * (value / strongest);
        return (
          <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '1fr 56px', gap: 10, alignItems: 'center' }}>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                }}
              >
                <span style={{ color: 'var(--text)' }}>{row.label}</span>
                <span>
                  {(row.rosteredMinutes / 60).toFixed(0)} h · {row.doctors}{' '}
                  {row.doctors === 1 ? 'doctor' : 'doctors'}
                </span>
              </div>
              <div
                style={{ height: 10, background: 'var(--bg-soft)', borderRadius: 999 }}
                title={`${row.label}: ${value.toFixed(1)}% utilisation`}
              >
                <div
                  style={{
                    width: `${Math.min(100, (value / ceiling) * 100)}%`,
                    height: '100%',
                    background: 'var(--cap-bar)',
                    opacity: strength,
                    // Square at the baseline, rounded at the data end.
                    borderRadius: '0 4px 4px 0',
                    minWidth: value > 0 ? 4 : 0,
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'right',
                color: value > 100 ? 'var(--cap-cancelled)' : 'var(--text)',
              }}
            >
              {value.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
