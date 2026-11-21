/**
 * Route skeleton for Match doctor names.
 *
 * The page is force-dynamic and runs requireAdmin before it renders, and
 * CapacityNamesClient then fetches its suggestions from the browser.
 *
 * Its own loading state is a single card holding a 220px line over a block
 * (CapacityNamesClient.tsx), and this deliberately paints exactly that. The
 * route skeleton hands over to the client skeleton without the layout moving,
 * so the two waits read as one.
 *
 * prefers-reduced-motion is covered by the global rule for .skeleton-*.
 */
export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton-line" style={{ width: 245, height: 32 }} />
      </div>
      <div className="skeleton-card">
        <div className="skeleton-line" style={{ width: 220, marginBottom: 16 }} />
        <div className="skeleton-block" />
      </div>
    </>
  );
}
