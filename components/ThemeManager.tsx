'use client';
import { useEffect } from 'react';

// Sprint 28A — Theme applier. Reads the Settings appearance preference
// (localStorage 'hp-settings' → {appearance: 'light'|'dark'|'system'}) and
// reflects it onto <html data-theme="…">, which drives the dark tokens in
// globals.css. Renders no UI. It reacts to:
//   • live switches from the Settings page  → 'healpath:settings-changed' event
//   • changes made in another tab           → 'storage' event
//   • the OS scheme while in System mode     → matchMedia change
// The no-flash inline script in layout.tsx applies the same result before paint;
// this component keeps it in sync afterwards.

type Appearance = 'light' | 'dark' | 'system';

function readAppearance(): Appearance {
  try {
    const s = JSON.parse(localStorage.getItem('hp-settings') ?? '{}');
    return s.appearance === 'dark' || s.appearance === 'light' ? s.appearance : 'system';
  } catch {
    return 'system';
  }
}

function apply(appearance: Appearance) {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export default function ThemeManager() {
  useEffect(() => {
    const sync = () => apply(readAppearance());
    sync();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    window.addEventListener('healpath:settings-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('healpath:settings-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return null;
}
