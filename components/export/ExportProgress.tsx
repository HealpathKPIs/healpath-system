'use client';

// Non-blocking export progress overlay (Sprint 45). Shown while an export runs
// so large dashboards never look frozen. Excluded from captures.

import { EXPORT_EXCLUDE_ATTR } from '@/lib/export/constants';
import type { ExportProgressState } from '@/lib/export/types';

const LABEL: Record<Exclude<ExportProgressState['phase'], 'idle'>, string> = {
  preparing: 'Preparing Report…',
  downloading: 'Downloading…',
};

export default function ExportProgress({ state }: { state: ExportProgressState }) {
  if (state.phase === 'idle') return null;
  return (
    <div
      {...{ [EXPORT_EXCLUDE_ATTR]: 'true' }}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(15, 23, 42, .35)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 12,
          justifyItems: 'center',
          minWidth: 260,
          padding: '22px 26px',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '3px solid var(--surface-3)',
            borderTopColor: 'var(--accent)',
            animation: 'hp-export-spin .8s linear infinite',
          }}
        />
        <div style={{ fontWeight: 800, color: 'var(--text-strong)' }}>{LABEL[state.phase]}</div>
        {state.detail ? <div className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>{state.detail}</div> : null}
      </div>
      <style>{'@keyframes hp-export-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){[role="status"] span{animation:none!important}}'}</style>
    </div>
  );
}
