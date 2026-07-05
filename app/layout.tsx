import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import { DashboardProvider } from '@/lib/dashboard-context';

export const metadata: Metadata = {
  title: 'HealPath BI',
  description: 'HealPath Executive BI Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DashboardProvider>
          <div className="app">
            <Nav />
            <main className="main">{children}</main>
          </div>
        </DashboardProvider>
      </body>
    </html>
  );
}
