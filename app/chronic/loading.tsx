function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="card kpi-card" aria-hidden="true">
      <div className="skeleton-line" style={{ width: 118, height: 12 }} />
      <div className="skeleton-line" style={{ width: compact ? 96 : 168, height: 34, marginTop: 16 }} />
      <div className="skeleton-line" style={{ width: '70%', height: 12, marginTop: 14 }} />
    </div>
  );
}

function SectionTitleSkeleton() {
  return <div className="skeleton-line" style={{ width: 190, height: 14 }} aria-hidden="true" />;
}

function TableSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <div className="skeleton-line" style={{ width: 210, height: 14 }} />
      <div className="skeleton-block" style={{ height: 270, marginTop: 16 }} />
    </div>
  );
}

export default function ChronicLoading() {
  return (
    <section className="chronic-dashboard" aria-busy="true" aria-label="Loading chronic dashboard">
      <div className="pagehead">
        <div>
          <div className="skeleton-line" style={{ width: 220, height: 34 }} />
          <div className="skeleton-line" style={{ width: 420, maxWidth: '100%', height: 14, marginTop: 12 }} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="skeleton-line" style={{ width: 82, height: 38 }} />
          <div className="skeleton-line" style={{ width: 82, height: 38 }} />
        </div>
      </div>

      <div className="filters">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="skeleton-line" key={index} style={{ width: index === 4 ? 190 : 150, height: 38 }} />
        ))}
        <div className="skeleton-line" style={{ width: 78, height: 38 }} />
        <div className="skeleton-line" style={{ width: 72, height: 38 }} />
      </div>

      <div className="card">
        <div className="skeleton-line" style={{ width: 170, height: 14 }} />
        <div className="skeleton-line" style={{ width: 460, maxWidth: '100%', height: 12, marginTop: 12 }} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 16 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="skeleton-block" key={index} style={{ height: 62, borderRadius: 8 }} />
          ))}
        </div>
      </div>

      <section className="chronic-section">
        <SectionTitleSkeleton />
        <div className="grid kpirow">
          {Array.from({ length: 7 }).map((_, index) => <SkeletonCard key={index} />)}
        </div>
      </section>

      <section className="chronic-section">
        <SectionTitleSkeleton />
        <div className="grid chronic-chart-grid">
          <div className="card"><div className="skeleton-block" style={{ height: 260 }} /></div>
          <div className="card"><div className="skeleton-block" style={{ height: 260 }} /></div>
        </div>
      </section>

      <section className="chronic-section">
        <SectionTitleSkeleton />
        <TableSkeleton />
      </section>

      <section className="chronic-section">
        <SectionTitleSkeleton />
        <TableSkeleton />
      </section>

      <section className="chronic-section">
        <SectionTitleSkeleton />
        <div className="grid kpirow">
          {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} compact />)}
        </div>
      </section>
    </section>
  );
}
