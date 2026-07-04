// Server-side Supabase client. Uses the service role key — must never be
// imported into a client component. All API route handlers use this.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Fail loudly at call time rather than shipping a half-configured client.
  console.warn('Supabase env vars missing — API routes will fall back to the bundled 2026 snapshot.');
}

export const supabase =
  url && serviceKey
    ? createClient(url, serviceKey, {
        db: { schema: 'healpath' },
        auth: { persistSession: false },
      })
    : null;

export const hasSupabase = Boolean(url && serviceKey);
