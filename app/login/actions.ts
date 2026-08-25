'use server';

import { redirect } from 'next/navigation';

import { getSupabaseAuthAdminClient } from '@/lib/supabase-auth-admin';
import { canAccessPath, isAppRole } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim();
}

function safeNextPath(value: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function login(formData: FormData) {
  const email = field(formData, 'email').toLowerCase();
  const password = field(formData, 'password');
  const nextPath = safeNextPath(field(formData, 'next'));
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    const reason = error?.message.toLowerCase().includes('banned') ? 'disabled' : 'invalid';
    redirect(`/login?error=${reason}`);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('active, role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile || !profile.active || !isAppRole(profile.role)) {
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  await getSupabaseAuthAdminClient()
    .from('profiles')
    .update({ last_login: new Date().toISOString() })
    .eq('id', data.user.id);

  redirect(canAccessPath({ active: profile.active, role: profile.role }, nextPath) ? nextPath : '/');
}
