export default function ChronicAnalyticsLoading() {
  return (
    <section style={{ display: 'grid', gap: 22 }}>
      <div className="pagehead">
        <div>
          <div className="skeleton-line" style={{ width: 310, height: 32 }} />
          <div className="skeleton-line" style={{ width: 460, height: 14, marginTop: 12 }} />
        </div>
      </div>
      <div className="filters">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton-line" style={{ width: index === 5 ? 190 : 150, height: 38 }} key={index} />
        ))}
      </div>
      <div className="grid kpirow">
        {Array.from({ length: 7 }).map((_, index) => (
          <div className="card kpi-card" key={index}>
            <div className="skeleton-line" style={{ width: 120, height: 12 }} />
            <div className="skeleton-line" style={{ width: 110, height: 34, marginTop: 14 }} />
          </div>
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, section) => (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }} key={section}>
          <div className="card"><div className="skeleton-block" style={{ height: 190 }} /></div>
          <div className="card"><div className="skeleton-block" style={{ height: 190 }} /></div>
          <div className="card"><div className="skeleton-block" style={{ height: 190 }} /></div>
        </div>
      ))}
    </section>
  );
}
