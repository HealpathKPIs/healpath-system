/**
 * Route skeleton for Capacity import.
 *
 * The page is force-dynamic and runs requireAdmin before it renders, so there
 * is a round trip to cover even though the body itself is a client component.
 *
 * The import screen is a stack of titled cards - drop zone, schedule preview,
 * appointment preview, readiness checklist, upload history - so the skeleton is
 * that stack at the same heights rather than a single grey slab, and the first
 * card keeps the dashed 2px drop-zone outline the design system specifies so
 * the page does not change shape when it arrives.
 *
 * prefers-reduced-motion is covered by the global rule for .skeleton-*.
 */
export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton-line" style={{ width: 215, height: 32 }} />
      </div>

      {/* Drop zone. */}
      <div className="skeleton-card" style={{ marginBottom: 20 }}>
        <div className="skeleton-line" style={{ width: 160, marginBottom: 18 }} />
        <div
          style={{
            border: '2px dashed var(--border-strong, var(--border))',
            borderRadius: 'var(--r-md, 12px)',
            padding: '34px 20px',
            display: 'grid',
            justifyItems: 'center',
            gap: 12,
          }}
        >
          <div className="skeleton-line" style={{ width: 240, height: 14 }} />
          <div className="skeleton-line" style={{ width: 164 }} />
        </div>
      </div>

      {/* Schedule preview, appointment preview, readiness checklist. */}
      {[150, 190, 170].map((titleWidth, card) => (
        <div className="skeleton-card" key={card} style={{ marginBottom: 20 }}>
          <div className="skeleton-line" style={{ width: titleWidth, marginBottom: 18 }} />
          <div className="skeleton-block" style={{ height: card === 2 ? 128 : 172 }} />
        </div>
      ))}

      {/* Upload history. */}
      <div className="skeleton-card">
        <div className="skeleton-line" style={{ width: 140, marginBottom: 18 }} />
        {Array.from({ length: 4 }).map((_, row) => (
          <div
            key={row}
            style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.7fr 0.7fr', gap: 14, padding: '9px 0' }}
          >
            {Array.from({ length: 4 }).map((_, cell) => (
              <div className="skeleton-line" key={cell} style={{ height: 13, width: cell === 0 ? '84%' : '54%' }} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
