import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { isAppRole, type UserProfile } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
};

function toUserProfile(row: ProfileRow): UserProfile | null {
  if (!isAppRole(row.role)) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    active: row.active,
    lastLogin: row.last_login,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const getCurrentProfile = cache(async function getCurrentProfile() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, active, last_login, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data) return null;
  return toUserProfile(data as ProfileRow);
});

export async function requireCurrentProfile() {
  const profile = await getCurrentProfile();

  if (!profile) redirect('/login');
  if (!profile.active) redirect('/access-denied?reason=disabled');

  return profile;
}

export async function requireAdmin() {
  const profile = await requireCurrentProfile();

  if (profile.role !== 'admin') redirect('/access-denied');
  return profile;
}
