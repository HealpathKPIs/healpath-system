'use client';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

// Premium command launcher. It does NOT implement search — it reuses the existing
// /api/search endpoint (Sprint 19) across every scope, and navigates using the
// existing per-page `?q=` filter. No new search engine, routing, or filters.

type Scope = 'doctors' | 'pharmacy' | 'diagnostics' | 'diseases';
const SCOPES: Scope[] = ['doctors', 'pharmacy', 'diagnostics', 'diseases'];

interface Item {
  icon: string;
  title: string;
  subtitle?: string;
  category: string;
  href: string;
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Map an existing search hit ({ label, hint }) to a palette item + reused route.
function toItem(scope: Scope, hit: { label: string; hint: string }): Item {
  const label = hit.label;
  const q = encodeURIComponent(label);
  if (scope === 'doctors') {
    return hit.hint === 'Specialty'
      ? { icon: '🩺', title: label, category: 'Specialty', href: `/doctors?q=${q}` }
      : { icon: '👨‍⚕️', title: label, category: 'Doctor', href: `/doctors?q=${q}` };
  }
  if (scope === 'pharmacy') {
    const category = hit.hint === 'Brand' ? 'Brand' : hit.hint === 'Generic' ? 'Medication' : 'Active Ingredient';
    const icon = hit.hint === 'Brand' ? '🏷️' : '💊';
    return { icon, title: titleCase(label), category, href: `/pharmacy?q=${q}` };
  }
  if (scope === 'diagnostics') {
    return hit.hint === 'Scan'
      ? { icon: '🩻', title: label, category: 'Scan', href: `/diagnostics?q=${q}` }
      : { icon: '🧪', title: label, category: 'Laboratory', href: `/diagnostics?q=${q}` };
  }
  // diseases: label = diagnosis name, hint = ICD code
  return { icon: '📄', title: label, subtitle: hit.hint ? `ICD ${hit.hint}` : undefined, category: 'Diagnosis', href: `/diseases?q=${q}` };
}

// Interleave scope result lists so the 8-cap stays diverse across entity types.
function mergeRoundRobin(lists: Item[][], cap: number): Item[] {
  const out: Item[] = [];
  for (let i = 0; out.length < cap; i += 1) {
    let added = false;
    for (const list of lists) {
      if (list[i]) { out.push(list[i]); added = true; if (out.length >= cap) break; }
    }
    if (!added) break;
  }
  return out;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open: Ctrl/Cmd+K (toggle) or a custom event dispatched by the nav button.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen((o) => !o); }
    }
    function onOpen() { setOpen(true); }
    window.addEventListener('keydown', onKey);
    window.addEventListener('healpath:command-open', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('healpath:command-open', onOpen); };
  }, []);

  // Focus/reset + lock body scroll while open.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { clearTimeout(t); document.body.style.overflow = prev; };
    }
    setQ(''); setItems([]); setActive(0);
  }, [open]);

  // Debounced multi-scope search — reuses /api/search verbatim.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setItems([]); return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const lists = await Promise.all(SCOPES.map((s) =>
          fetch(`/api/search?scope=${s}&q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
            .then((r) => r.json())
            .then((d) => ((d.results ?? []) as { label: string; hint: string }[]).map((h) => toItem(s, h)))
            .catch(() => [] as Item[])));
        setItems(mergeRoundRobin(lists, 8));
        setActive(0);
      } catch { /* aborted */ }
    }, 250);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q, open]);

  const choose = useCallback((item: Item) => {
    setOpen(false);
    router.push(item.href);
  }, [router]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.30)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 16px 16px' }}
    >
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette"
        style={{ width: 'min(100%, 620px)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search doctors, medications, labs, diagnoses…"
          role="combobox" aria-expanded aria-autocomplete="list"
          style={{ width: '100%', border: 0, borderBottom: '1px solid var(--border)', outline: 'none', padding: '18px 20px', fontSize: 16, background: 'transparent', color: 'var(--text)' }}
        />
        <div role="listbox" style={{ maxHeight: '52vh', overflowY: 'auto', padding: 8 }}>
          {items.length === 0 ? (
            <div style={{ padding: '18px 14px', color: 'var(--text-soft)', fontSize: 14 }}>
              {q.trim().length < 2 ? 'Type at least 2 characters to search…' : 'No matches'}
            </div>
          ) : items.map((item, i) => (
            <div
              key={`${item.href}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(item); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', background: i === active ? 'var(--surface-2)' : 'transparent' }}
            >
              <span style={{ fontSize: 20, width: 28, textAlign: 'center', flex: '0 0 auto' }}>{item.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                {item.subtitle && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-soft)' }}>{item.subtitle}</span>}
              </span>
              <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 9px' }}>{item.category}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`.cmdk-panel{animation:cmdkIn 160ms cubic-bezier(0.16,1,0.3,1) both}@keyframes cmdkIn{from{opacity:0;transform:translateY(-10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@media (prefers-reduced-motion: reduce){.cmdk-panel{animation:none}}`}</style>
    </div>
  );
}
