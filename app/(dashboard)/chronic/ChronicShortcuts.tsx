'use client';

import { useEffect } from 'react';

function focusSelector(selector: string) {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  target.focus({ preventScroll: true });
}

export default function ChronicShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      const key = event.key.toLowerCase();
      const shortcuts: Record<string, string> = {
        f: '#chronic-patient-search',
        e: '[data-export-center]',
        '1': '#chronic-executive-comparison',
        '2': '#chronic-clinical-outcome',
        '3': '#chronic-issue-comparison',
        '4': '#chronic-recommendation-comparison',
        '5': '#chronic-operational-kpis',
      };
      const selector = shortcuts[key];
      if (!selector) return;
      event.preventDefault();
      focusSelector(selector);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <p className="sr-only" id="chronic-keyboard-shortcuts">
      Keyboard shortcuts: Alt F moves to Patient Search, Alt E moves to Export Center, Alt 1 through Alt 5 move between dashboard sections.
    </p>
  );
}
