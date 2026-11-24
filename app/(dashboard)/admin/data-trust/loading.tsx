/**
 * Route skeleton for Data Trust.
 *
 * The page is force-dynamic and waits on getDataTrustReport, which runs its
 * integrity and reconciliation checks before anything can paint. Without this
 * the browser holds the previous route on screen for the whole of that wait.
 *
 * Geometry mirrors the real page: status strip, the seven reconciliation
 * counts, the data-quality section, then the two-up coverage/governance pair.
 * The shimmer is the house .skeleton-* primitive, so prefers-reduced-motion is
 * honoured by the global rule in globals.css rather than repeated here.
 */
export default function Loading() {
  return (
    <section style={{ display: 'grid', gap: 20, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead">
        <div>
          <div className="skeleton-line" style={{ width: 150, height: 11, marginBottom: 9 }} />
          <div className="skeleton-line" style={{ width: 190, height: 32 }} />
          <div className="skeleton-line" style={{ width: 'min(100%, 520px)', marginTop: 12 }} />
        </div>
      </div>

      {/* Source / operational strip, with its tone bar on the left. */}
      <div
        className="skeleton-card"
        style={{
          borderLeft: '4px solid var(--border-strong, var(--border))',
          display: 'flex',
          gap: 14,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 320px' }}>
          <div className="skeleton-line" style={{ width: 'min(100%, 360px)', height: 14 }} />
          <div className="skeleton-line" style={{ width: 'min(100%, 430px)', marginTop: 9 }} />
        </div>
        <div className="skeleton-line" style={{ width: 196, height: 34, borderRadius: 10 }} />
      </div>

      <div className="skeleton-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        {Array.from({ length: 7 }).map((_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-line" style={{ width: '72%', height: 11, marginBottom: 18 }} />
            <div className="skeleton-line" style={{ width: 96, height: 28 }} />
          </div>
        ))}
      </div>

      <div className="skeleton-card">
        <div className="skeleton-line" style={{ width: 180, marginBottom: 18 }} />
        <div className="skeleton-block" style={{ height: 168 }} />
      </div>

      <div className="skeleton-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
        {Array.from({ length: 2 }).map((_, card) => (
          <div className="skeleton-card" key={card}>
            <div className="skeleton-line" style={{ width: 170, marginBottom: 18 }} />
            {Array.from({ length: 6 }).map((_, row) => (
              <div
                className="skeleton-line"
                key={row}
                style={{ width: `${86 - row * 7}%`, marginBottom: 11 }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
