export const PRIMARY_ADMIN_EMAIL = 'ahmedramadan@healpath.care';

export const APP_ROLES = ['admin', 'viewer'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
};

const ADMIN_ONLY_PATHS = [
  '/admin/import',
  '/admin/patient-master',
  '/chronic/import',
  // Only the import page, never '/capacity' itself: this list matches by
  // prefix, so listing the section would hide every capacity result from
  // viewers, who are meant to see them.
  '/capacity/import',
  '/capacity/names',
  '/users',
] as const;

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function isPrimaryAdminEmail(email: string) {
  return email.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL;
}

export function isAdminOnlyPath(pathname: string) {
  return ADMIN_ONLY_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function canAccessPath(
  profile: Pick<UserProfile, 'active' | 'role'>,
  pathname: string,
) {
  if (!profile.active) return false;
  if (profile.role === 'admin') return true;
  return !isAdminOnlyPath(pathname);
}

