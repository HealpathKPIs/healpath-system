export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton-line" style={{ width: 220, height: 34 }} />
        <div className="filters">
          <div className="skeleton-line" style={{ width: 150, height: 28 }} />
          <div className="skeleton-line" style={{ width: 150, height: 28 }} />
        </div>
      </div>
      <div className="skeleton-grid skeleton-kpis">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="skeleton-card" key={i}>
            <div className="skeleton-line" style={{ width: 80, marginBottom: 22 }} />
            <div className="skeleton-line" style={{ width: 110, height: 34 }} />
          </div>
        ))}
      </div>
      <div className="skeleton-grid two" style={{ marginBottom: 18 }}>
        <div className="skeleton-card"><div className="skeleton-block" /></div>
        <div className="skeleton-card"><div className="skeleton-block" /></div>
      </div>
      <div className="skeleton-card"><div className="skeleton-block" /></div>
      <div className="skeleton-card" style={{ marginTop: 20, minHeight: 250 }}>
        <div className="skeleton-line" style={{ width: 160, marginBottom: 18 }} />
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 12, alignItems: 'center' }}>
              <div className="skeleton-line" style={{ width: 32, height: 32 }} />
              <div className="skeleton-line" style={{ width: 'min(100%, 520px)', height: 18 }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
