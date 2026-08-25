export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton-line" style={{ width: 240, height: 32 }} />
        <div className="filters">
          <div className="skeleton-line" style={{ width: 150, height: 28 }} />
          <div className="skeleton-line" style={{ width: 150, height: 28 }} />
        </div>
      </div>
      <div className="skeleton-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="skeleton-card" key={i}>
            <div className="skeleton-line" style={{ width: 90, marginBottom: 24 }} />
            <div className="skeleton-line" style={{ width: 120, height: 34 }} />
          </div>
        ))}
      </div>
      <div className="skeleton-grid two" style={{ marginBottom: 20 }}>
        <div className="skeleton-card"><div className="skeleton-block" /></div>
        <div className="skeleton-card"><div className="skeleton-block" /></div>
      </div>
      <div className="skeleton-card"><div className="skeleton-block" style={{ height: 300 }} /></div>
    </>
  );
}
