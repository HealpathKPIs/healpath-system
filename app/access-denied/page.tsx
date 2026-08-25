import Link from 'next/link';

import { logout } from '@/app/auth-actions';

type AccessDeniedProps = {
  searchParams?: { reason?: string };
};

export default function AccessDeniedPage({ searchParams }: AccessDeniedProps) {
  const disabled = searchParams?.reason === 'disabled';
  const configuration = searchParams?.reason === 'configuration';

  return (
    <main className="denied-page">
      <section className="denied-card">
        <span className="denied-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5c0 4.8 3.1 8.5 7.5 10 4.4-1.5 7.5-5.2 7.5-10V6L12 3Z" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
        </span>
        <span className="auth-eyebrow">403 · Protected area</span>
        <h1>{configuration ? 'Authentication needs configuration' : disabled ? 'Account disabled' : 'Administrator access required'}</h1>
        <p>
          {configuration
            ? 'HealPath could not verify accounts because its authentication environment is incomplete.'
            : disabled
              ? 'This account is currently disabled. Ask the HealPath administrator to restore access.'
              : 'Viewer accounts can explore and export every dashboard, but import and user-management areas are restricted to the Administrator.'}
        </p>
        <div className="denied-actions">
          {!configuration && !disabled ? <Link href="/">Return to dashboard</Link> : null}
          {!configuration ? (
            <form action={logout}>
              <button type="submit">Sign out</button>
            </form>
          ) : (
            <Link href="/login">Return to sign in</Link>
          )}
        </div>
      </section>
    </main>
  );
}

