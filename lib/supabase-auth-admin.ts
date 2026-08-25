import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let authAdminClient: SupabaseClient | null = null;

export function getSupabaseAuthAdminClient() {
  if (authAdminClient) return authAdminClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase Admin environment variables are missing.');
  }

  authAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return authAdminClient;
}
