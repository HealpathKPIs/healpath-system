'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

type Hit = { label: string; hint: string };

// Wrap the first case-insensitive occurrence of `term` in the label.
function highlight(text: string, term: string): ReactNode {
  const t = term.trim();
  if (!t) return text;
  const i = text.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: 'rgba(99,102,241,.20)', color: 'inherit', padding: 0, borderRadius: 2 }}>
        {text.slice(i, i + t.length)}
      </mark>
      {text.slice(i + t.length)}
    </>
  );
}

// Reusable executive search: debounced (300ms), min 2 chars, ILIKE-backed
// autocomplete with highlighted matches + keyboard navigation. Selecting a
// result sets ?q, which the server page consumes to filter its data.
export default function SearchBox({ scope, placeholder }: { scope: string; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  function pushQuery(value: string) {
    const next = new URLSearchParams(params.toString());
    const v = value.trim();
    if (v.length >= 2) next.set('q', v); else next.delete('q');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Debounced suggestion fetch (300ms). Under 2 chars: no results and clear ?q.
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      setResults([]);
      setOpen(false);
      if (params.get('q')) {
        const next = new URLSearchParams(params.toString());
        next.delete('q');
        const query = next.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(t)}`, { signal: ctrl.signal });
        const data = await res.json();
        setResults(data.results ?? []);
        setActive(-1);
        setOpen(true);
      } catch {
        /* aborted */
      }
    }, 300);
    return () => { clearTimeout(id); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, scope]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function choose(hit: Hit) {
    setTerm(hit.label);
    pushQuery(hit.label);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open && results.length) setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open && results.length) setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && results[active]) choose(results[active]);
      else { pushQuery(term); setOpen(false); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', width: 'min(100%, 380px)', marginBottom: 16 }}>
      <input
        className="search"
        style={{ width: '100%', marginBottom: 0 }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={placeholder ?? 'Search…'}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0,
            margin: 0, padding: 4, listStyle: 'none', background: '#fff',
            border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-md)',
            maxHeight: 300, overflowY: 'auto',
          }}
        >
          {results.length === 0 ? (
            <li style={{ padding: '8px 10px', color: 'var(--text-soft)', fontSize: 13 }}>No matches</li>
          ) : results.map((hit, i) => (
            <li
              key={`${hit.label}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(hit); }}
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
                padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 13,
                background: i === active ? 'var(--surface-2)' : 'transparent',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {highlight(hit.label, term)}
              </span>
              <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {hit.hint}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
