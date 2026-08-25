import { Suspense } from 'react';

import CommandPalette from '@/components/CommandPalette';
import Nav from '@/components/Nav';
import PageTransition from '@/components/PageTransition';
import ExportToolbar from '@/components/export/ExportToolbar';
import { requireCurrentProfile } from '@/lib/auth-server';
import { DashboardProvider } from '@/lib/dashboard-context';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireCurrentProfile();

  return (
    <DashboardProvider>
      <div className="app">
        <Nav profile={profile} />
        <main className="main">
          <Suspense fallback={null}>
            <ExportToolbar />
          </Suspense>
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <CommandPalette />
    </DashboardProvider>
  );
}

