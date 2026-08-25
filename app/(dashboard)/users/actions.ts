'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth-server';
import { isPrimaryAdminEmail } from '@/lib/rbac';
import { getSupabaseAuthAdminClient } from '@/lib/supabase-auth-admin';

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim();
}

function finish(message: string, type: 'success' | 'error' = 'success'): never {
  revalidatePath('/users');
  redirect(`/users?${type}=${encodeURIComponent(message)}`);
}

async function editableViewer(userId: string) {
  const supabase = getSupabaseAuthAdminClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('email, role')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data || data.role !== 'viewer' || isPrimaryAdminEmail(data.email)) {
    return null;
  }

  return data as { email: string; role: 'viewer' };
}

export async function createViewerAction(formData: FormData) {
  await requireAdmin();

  const fullName = textField(formData, 'fullName');
  const email = textField(formData, 'email').toLowerCase();
  const password = textField(formData, 'password');

  if (!fullName || !email || password.length < 8) {
    finish('Enter a name, valid email, and temporary password of at least 8 characters.', 'error');
  }
  if (isPrimaryAdminEmail(email)) {
    finish('The primary Administrator account already exists.', 'error');
  }

  const supabase = getSupabaseAuthAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error || !data.user) {
    finish(error?.message ?? 'The Viewer account could not be created.', 'error');
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      active: true,
      email,
      full_name: fullName,
      role: 'viewer',
    })
    .eq('id', data.user.id);

  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id);
    finish('The Viewer profile could not be activated. No account was kept.', 'error');
  }

  finish(`Viewer account created for ${email}.`);
}

export async function updateViewerAction(formData: FormData) {
  await requireAdmin();

  const userId = textField(formData, 'userId');
  const fullName = textField(formData, 'fullName');
  const email = textField(formData, 'email').toLowerCase();

  if (!userId || !fullName || !email || isPrimaryAdminEmail(email)) {
    finish('Enter a valid Viewer name and email.', 'error');
  }
  if (!(await editableViewer(userId))) {
    finish('Only Viewer accounts can be edited here.', 'error');
  }

  const supabase = getSupabaseAuthAdminClient();
  const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
    email,
    user_metadata: { full_name: fullName },
  });
  if (authError) finish(authError.message, 'error');

  const { error } = await supabase
    .from('profiles')
    .update({ email, full_name: fullName, role: 'viewer' })
    .eq('id', userId);
  if (error) finish(error.message, 'error');

  finish(`Viewer details updated for ${email}.`);
}

export async function setViewerActiveAction(formData: FormData) {
  await requireAdmin();

  const userId = textField(formData, 'userId');
  const active = textField(formData, 'active') === 'true';
  const viewer = await editableViewer(userId);
  if (!viewer) finish('Only Viewer accounts can be enabled or disabled.', 'error');

  const supabase = getSupabaseAuthAdminClient();

  if (active) {
    const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
    });
    if (authError) finish(authError.message, 'error');
  }

  const { error } = await supabase.from('profiles').update({ active }).eq('id', userId);
  if (error) finish(error.message, 'error');

  if (!active) {
    const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: '876000h',
    });
    if (authError) finish(authError.message, 'error');
  }

  finish(`${viewer.email} is now ${active ? 'active' : 'disabled'}.`);
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();

  const userId = textField(formData, 'userId');
  const password = textField(formData, 'password');
  if (!userId || password.length < 8) {
    finish('Enter a new password of at least 8 characters.', 'error');
  }

  const supabase = getSupabaseAuthAdminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) finish('The selected account no longer exists.', 'error');

  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) finish(error.message, 'error');

  finish(`Password updated for ${profile.email}.`);
}

