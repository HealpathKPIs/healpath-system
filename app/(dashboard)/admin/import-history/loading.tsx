/**
 * Route skeleton for Import History.
 *
 * The page is force-dynamic and reads up to a hundred import batches before it
 * can paint, so the ledger table is what the skeleton has to stand in for.
 * Ten rows, matching the compact-table geometry in the design system: a sticky
 * header band, then rows at the real row height.
 *
 * prefers-reduced-motion is handled by the global rule that governs every
 * .skeleton-* element, so nothing is repeated here.
 */
export default function Loading() {
  return (
    <section style={{ display: 'grid', gap: 20, width: 'min(100%, 1560px)', margin: '0 auto' }}>
      <div className="pagehead">
        <div>
          <div className="skeleton-line" style={{ width: 132, height: 11, marginBottom: 9 }} />
          <div className="skeleton-line" style={{ width: 215, height: 32 }} />
          <div className="skeleton-line" style={{ width: 'min(100%, 560px)', marginTop: 12 }} />
        </div>
      </div>

      <div className="skeleton-line" style={{ width: 'min(100%, 300px)' }} />

      <div className="skeleton-card">
        {/* Header band, then the ledger rows. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr 0.8fr',
            gap: 14,
            paddingBottom: 12,
            marginBottom: 14,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="skeleton-line" key={index} style={{ height: 11, width: '68%' }} />
          ))}
        </div>

        {Array.from({ length: 10 }).map((_, row) => (
          <div
            key={row}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr 0.8fr',
              gap: 14,
              padding: '9px 0',
            }}
          >
            {Array.from({ length: 5 }).map((_, cell) => (
              <div
                className="skeleton-line"
                key={cell}
                style={{ height: 13, width: cell === 0 ? '88%' : '58%' }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
