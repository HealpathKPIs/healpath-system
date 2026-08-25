import { login } from '@/app/login/actions';

type LoginPageProps = {
  searchParams?: {
    error?: string;
    next?: string;
  };
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  const invalid = searchParams?.error === 'invalid';
  const disabled = searchParams?.error === 'disabled';
  const nextPath = searchParams?.next?.startsWith('/') ? searchParams.next : '/';

  return (
    <main className="auth-page">
      <div className="auth-orb auth-orb-one" aria-hidden="true" />
      <div className="auth-orb auth-orb-two" aria-hidden="true" />

      <section className="auth-showcase" aria-label="HealPath healthcare intelligence">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M24 7v34M7 24h34" />
              <circle cx="24" cy="24" r="19" />
            </svg>
          </span>
          <span>HealPath</span>
          <small>BI</small>
        </div>

        <div className="auth-showcase-copy">
          <span className="auth-eyebrow">Healthcare intelligence, protected</span>
          <h1>Clear decisions begin with trusted access.</h1>
          <p>
            A secure workspace for patient insights, clinical trends, pharmacy
            performance, and executive reporting.
          </p>
        </div>

        <div className="auth-pulse-card" aria-hidden="true">
          <div className="auth-pulse-head">
            <span>Live care overview</span>
            <span className="auth-live"><i /> Protected</span>
          </div>
          <svg viewBox="0 0 520 130" preserveAspectRatio="none">
            <defs>
              <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#52d7b8" stopOpacity=".34" />
                <stop offset="1" stopColor="#52d7b8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="auth-pulse-fill" d="M0,96 C34,90 50,92 77,80 C104,68 117,84 145,72 C174,59 184,24 210,30 C242,38 246,88 278,82 C310,76 321,55 346,58 C377,62 389,79 416,69 C447,57 468,24 520,31 L520,130 L0,130 Z" />
            <path className="auth-pulse-line" d="M0,96 C34,90 50,92 77,80 C104,68 117,84 145,72 C174,59 184,24 210,30 C242,38 246,88 278,82 C310,76 321,55 346,58 C377,62 389,79 416,69 C447,57 468,24 520,31" />
          </svg>
          <div className="auth-metrics">
            <span><b>12</b><small>Insight areas</small></span>
            <span><b>24/7</b><small>Secure access</small></span>
            <span><b>Live</b><small>Reporting data</small></span>
          </div>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-mobile-brand">
            <span className="auth-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48"><path d="M24 7v34M7 24h34" /><circle cx="24" cy="24" r="19" /></svg>
            </span>
            HealPath
          </div>
          <span className="auth-secure-pill">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            Secure portal
          </span>
          <h2>Welcome back</h2>
          <p className="auth-form-intro">Sign in with your HealPath account to continue.</p>

          {invalid || disabled ? (
            <div className="auth-alert" role="alert">
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>
              <span>
                {disabled
                  ? 'This account is disabled. Contact the HealPath administrator.'
                  : 'The email or password you entered is incorrect.'}
              </span>
            </div>
          ) : null}

          <form action={login} className="auth-form">
            <input name="next" type="hidden" value={nextPath} />
            <label htmlFor="email">Work email</label>
            <div className="auth-input-wrap">
              <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
              <input
                autoComplete="email"
                autoFocus
                id="email"
                name="email"
                placeholder="name@healpath.care"
                required
                type="email"
              />
            </div>
            <label htmlFor="password">Password</label>
            <div className="auth-input-wrap">
              <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <input
                autoComplete="current-password"
                id="password"
                minLength={8}
                name="password"
                placeholder="Enter your password"
                required
                type="password"
              />
            </div>
            <button type="submit" className="auth-submit">
              Sign in securely
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>

          <div className="auth-trust-note">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 4.5 6v5c0 4.8 3.1 8.5 7.5 10 4.4-1.5 7.5-5.2 7.5-10V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
            Your session is encrypted and role-protected.
          </div>
        </div>
        <p className="auth-support">Need access? Contact your HealPath administrator.</p>
      </section>
    </main>
  );
}

