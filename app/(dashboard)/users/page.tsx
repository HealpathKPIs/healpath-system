import {
  createViewerAction,
  resetPasswordAction,
  setViewerActiveAction,
  updateViewerAction,
} from './actions';

import { requireAdmin } from '@/lib/auth-server';
import { isPrimaryAdminEmail } from '@/lib/rbac';
import { getSupabaseAuthAdminClient } from '@/lib/supabase-auth-admin';

type UsersPageProps = {
  searchParams?: { error?: string; success?: string };
};

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'viewer';
  active: boolean;
  last_login: string | null;
  created_at: string;
};

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  await requireAdmin();
  const supabase = getSupabaseAuthAdminClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, active, last_login, created_at')
    .order('created_at');
  const profiles = (data ?? []) as ProfileRow[];

  return (
    <div className="users-page">
      <header className="users-hero">
        <div>
          <span className="users-kicker">Access administration</span>
          <h1>Users & permissions</h1>
          <p>Create secure Viewer accounts. Viewers can explore Settings and export every report, but all import areas remain unavailable.</p>
        </div>
        <div className="users-policy">
          <span><i className="users-dot admin" /> Administrator <b>Full control</b></span>
          <span><i className="users-dot viewer" /> Viewer <b>Read & export</b></span>
        </div>
      </header>

      {searchParams?.error || error ? (
        <div className="users-message error" role="alert">{searchParams?.error ?? error?.message}</div>
      ) : null}
      {searchParams?.success ? (
        <div className="users-message success" role="status">{searchParams.success}</div>
      ) : null}

      <section className="users-panel users-create-panel">
        <div className="users-panel-head">
          <span className="users-panel-icon" aria-hidden="true">+</span>
          <div>
            <h2>Create Viewer</h2>
            <p>The account is activated immediately with Viewer-only permissions.</p>
          </div>
        </div>
        <form action={createViewerAction} className="users-create-form">
          <label>Full name<input name="fullName" placeholder="Viewer name" required /></label>
          <label>Email<input name="email" placeholder="viewer@healpath.care" required type="email" /></label>
          <label>Temporary password<input minLength={8} name="password" placeholder="Minimum 8 characters" required type="password" /></label>
          <label>Role<input aria-label="Role" disabled value="Viewer" /></label>
          <button type="submit">Create Viewer</button>
        </form>
      </section>

      <section className="users-panel">
        <div className="users-panel-head users-list-head">
          <div>
            <h2>Platform accounts</h2>
            <p>{profiles.length} account{profiles.length === 1 ? '' : 's'} registered in HealPath.</p>
          </div>
          <span className="users-count">{profiles.filter((profile) => profile.active).length} active</span>
        </div>

        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr><th>User</th><th>Role</th><th>Access</th><th>Status</th><th>Last login</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const primaryAdmin = isPrimaryAdminEmail(profile.email);
                const editFormId = `edit-${profile.id}`;
                return (
                  <tr key={profile.id}>
                    <td>
                      {primaryAdmin ? (
                        <div className="users-identity"><b>{profile.full_name}</b><span>{profile.email}</span></div>
                      ) : (
                        <form action={updateViewerAction} className="users-inline-edit" id={editFormId}>
                          <input name="userId" type="hidden" value={profile.id} />
                          <input aria-label={`Full name for ${profile.email}`} defaultValue={profile.full_name} name="fullName" required />
                          <input aria-label={`Email for ${profile.full_name}`} defaultValue={profile.email} name="email" required type="email" />
                        </form>
                      )}
                    </td>
                    <td><span className={`users-role ${profile.role}`}>{profile.role === 'admin' ? 'Administrator' : 'Viewer'}</span></td>
                    <td><span className="users-access">{profile.role === 'admin' ? 'All areas' : 'All except imports'}</span></td>
                    <td><span className={`users-status ${profile.active ? 'active' : 'disabled'}`}><i />{profile.active ? 'Active' : 'Disabled'}</span></td>
                    <td><span className="users-date">{formatDateTime(profile.last_login)}</span></td>
                    <td>
                      <div className="users-actions">
                        {!primaryAdmin ? <button className="users-action-primary" form={editFormId} type="submit">Save</button> : null}
                        <form action={resetPasswordAction} className="users-reset-form">
                          <input name="userId" type="hidden" value={profile.id} />
                          <input aria-label={`New password for ${profile.full_name}`} minLength={8} name="password" placeholder="New password" required type="password" />
                          <button type="submit">Reset</button>
                        </form>
                        {!primaryAdmin ? (
                          <form action={setViewerActiveAction}>
                            <input name="userId" type="hidden" value={profile.id} />
                            <input name="active" type="hidden" value={String(!profile.active)} />
                            <button className={profile.active ? 'users-action-danger' : 'users-action-enable'} type="submit">
                              {profile.active ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

