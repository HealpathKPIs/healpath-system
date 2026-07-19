'use client';

export default function ChronicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="chronic-dashboard">
      <div className="pagehead">
        <div>
          <h1 className="pagetitle">Chronic Care</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            The dashboard could not finish loading.
          </p>
        </div>
      </div>
      <div className="card" role="alert" style={{ display: 'grid', gap: 12 }}>
        <p className="section-title">Dashboard Error</p>
        <p className="muted" style={{ margin: 0 }}>
          {error.message || 'A chronic dashboard section failed to render.'}
        </p>
        {error.digest ? <p className="muted" style={{ margin: 0, fontSize: 12 }}>Digest: {error.digest}</p> : null}
        <div>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 38,
              border: 0,
              borderRadius: 10,
              padding: '0 16px',
              background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))',
              color: '#fff',
              fontWeight: 850,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    </section>
  );
}
