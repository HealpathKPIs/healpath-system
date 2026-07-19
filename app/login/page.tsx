'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const searchParams = useSearchParams();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function signIn() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? 'Sign in failed.');
        return;
      }
      const next = searchParams?.get('next');
      location.href = next && next.startsWith('/') ? next : '/';
    } catch {
      setError('Sign in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="loginwrap">
      <form
        className="loginbox"
        onSubmit={(event) => { event.preventDefault(); void signIn(); }}
      >
        <div className="brand" style={{ padding: 0, marginBottom: 8 }}>Heal<span>Path</span></div>
        <p className="muted">Executive BI dashboard - shared access</p>
        <input
          type="password"
          placeholder="Dashboard password"
          value={pw}
          autoFocus
          onChange={(event) => setPw(event.target.value)}
        />
        {error ? (
          <p role="alert" style={{ margin: '0 0 12px', color: 'var(--danger)', fontSize: 13, fontWeight: 650 }}>{error}</p>
        ) : null}
        <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
