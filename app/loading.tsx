export default function RootLoading() {
  return (
    <main className="auth-neutral-loading" aria-busy="true" aria-live="polite">
      <span className="auth-loading-mark" aria-hidden="true">
        <span />
      </span>
      <p>Preparing secure access…</p>
    </main>
  );
}

