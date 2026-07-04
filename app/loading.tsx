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
    </>
  );
}
