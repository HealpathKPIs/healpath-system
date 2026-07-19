// Shared-password auth for the dashboard (Edge-safe: Web Crypto only, so this
// module works in both middleware and Node API routes).
//
// The session cookie carries a SHA-256 token derived from DASHBOARD_PASSWORD —
// not a forgeable literal — and the middleware verifies it on every request.
// When DASHBOARD_PASSWORD is not configured, the gate is disabled (local dev).

export const AUTH_COOKIE = 'hp_auth';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The valid session-cookie value for the configured dashboard password. */
export function authToken(secret: string): Promise<string> {
  return sha256Hex(`healpath-auth-v1:${secret}`);
}

/** Constant-shape password check (compares digests, not raw strings). */
export async function passwordMatches(candidate: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(`pw:${candidate}`), sha256Hex(`pw:${secret}`)]);
  return a === b;
}
