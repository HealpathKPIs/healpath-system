import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import { DashboardProvider } from '@/lib/dashboard-context';
import PageTransition from '@/components/PageTransition';
import CommandPalette from '@/components/CommandPalette';
import ThemeManager from '@/components/ThemeManager';

export const metadata: Metadata = {
  title: 'HealPath BI',
  description: 'HealPath Executive BI Dashboard',
};

// Applied before first paint so the theme never flashes light-then-dark.
// Mirrors components/ThemeManager (single logic, two moments).
const NO_FLASH_THEME = `(function(){try{var s=JSON.parse(localStorage.getItem('hp-settings')||'{}');var a=s.appearance;var d=a==='dark'||((a==='system'||!a)&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        <ThemeManager />
        <DashboardProvider>
          <div className="app">
            <Nav />
            <main className="main"><PageTransition>{children}</PageTransition></main>
          </div>
          <CommandPalette />
        </DashboardProvider>
      </body>
    </html>
  );
}
