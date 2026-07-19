'use client';

import type { ChronicKpiDrillStep } from '@/lib/queries';
import { useEffect, useId, useRef, useState } from 'react';

interface KpiDrilldownProps {
  title: string;
  steps: ChronicKpiDrillStep[];
  children: React.ReactNode;
}

export default function KpiDrilldown({ title, steps, children }: KpiDrilldownProps) {
  const dialogId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const hasData = steps.some((step) => step.rows.length > 0);
  const active = steps[stepIndex] ?? steps[0];
  const max = Math.max(...(active?.rows.map((row) => row.value) ?? [0]), 1);
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < steps.length - 1;

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const moveStep = (direction: -1 | 1) => {
    setStepIndex((value) => Math.min(steps.length - 1, Math.max(0, value + direction)));
  };

  return (
    <>
      <div
        role="button"
        tabIndex={hasData ? 0 : -1}
        aria-label={`Open ${title} KPI drilldown`}
        aria-disabled={!hasData}
        onClick={() => {
          if (!hasData) return;
          setStepIndex(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!hasData) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setStepIndex(0);
            setOpen(true);
          }
        }}
        style={{ cursor: hasData ? 'zoom-in' : 'default' }}
      >
        {children}
      </div>
      {open ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(15, 23, 42, .45)',
            padding: 18,
          }}
        >
          <section
            className="chronic-modal chronic-dialog-enter"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveStep(-1);
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveStep(1);
              }
            }}
            style={{
              maxHeight: '86vh',
              overflow: 'hidden',
              display: 'grid',
              gridTemplateRows: 'auto auto minmax(0, 1fr)',
              gap: 14,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface)',
              boxShadow: 'var(--shadow-lg)',
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <h2 id={dialogId} style={{ margin: 0, fontSize: 20, letterSpacing: 0 }}>{title}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>Executive drilldown</p>
              </div>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} style={toolbarButton} aria-label="Close KPI drilldown">X</button>
            </div>

            <div className="chronic-modal-toolbar" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {steps.map((step, index) => (
                  <button
                    key={step.title}
                    type="button"
                    onClick={() => setStepIndex(index)}
                    aria-pressed={index === stepIndex}
                    style={{
                      ...toolbarButton,
                      color: index === stepIndex ? 'var(--accent-ink)' : 'var(--text)',
                      background: index === stepIndex ? 'var(--accent-soft)' : 'var(--surface-2)',
                    }}
                  >
                    {step.title}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => moveStep(-1)} disabled={!canGoBack} style={{ ...toolbarButton, opacity: canGoBack ? 1 : .45, cursor: canGoBack ? 'pointer' : 'not-allowed' }}>Previous</button>
                <button type="button" onClick={() => moveStep(1)} disabled={!canGoNext} style={{ ...toolbarButton, opacity: canGoNext ? 1 : .45, cursor: canGoNext ? 'pointer' : 'not-allowed' }}>Next</button>
              </div>
            </div>

            <div style={{ minHeight: 0, overflow: 'auto', border: '1px solid var(--border-soft)', borderRadius: 8, padding: 14, background: 'var(--surface)' }}>
              <p className="section-title" style={{ marginBottom: 12 }}>{active?.title ?? 'Drilldown'}</p>
              {active?.rows.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {active.rows.map((row, index) => {
                    const pct = (row.value / max) * 100;
                    return (
                      <div key={`${row.label}-${index}`} title={`${row.label}: ${row.value.toLocaleString()}`} style={{ display: 'grid', gap: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                          <span className="rank-value">{row.value.toLocaleString()}</span>
                        </div>
                        <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--accent), var(--labs))' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="chart-empty">No drilldown data for this KPI and filter scope</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

const toolbarButton: React.CSSProperties = {
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  padding: '0 10px',
  fontWeight: 800,
  cursor: 'pointer',
};
