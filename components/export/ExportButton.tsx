'use client';

// A single Export Center action button (Sprint 45). Follows the HealPath design
// system tokens. 'primary' is used for the Full Report call-to-action.

import type { ReactNode } from 'react';

export default function ExportButton({
  children,
  onClick,
  disabled,
  variant = 'default',
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary';
  title?: string;
}) {
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 34,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 13px',
        borderRadius: 9,
        border: primary ? '0' : '1px solid var(--border)',
        background: primary ? 'linear-gradient(180deg, var(--accent), var(--accent-strong))' : 'var(--surface)',
        color: primary ? '#fff' : 'var(--text)',
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: 750,
        letterSpacing: '-0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        boxShadow: primary ? '0 6px 14px rgba(99,102,241,.28)' : 'var(--shadow-xs)',
        transition: 'filter .14s ease, opacity .14s ease',
      }}
    >
      {children}
    </button>
  );
}
