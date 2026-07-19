'use client';
import { useEffect, useRef, useState } from 'react';

// Parse a KPI value (already-formatted string like "77,306"/"2.42", or a number)
// into { num, decimals }. Non-numeric values (e.g. "—") return null.
function parse(value: string | number): { num: number; decimals: number } | null {
  const raw = typeof value === 'number' ? value.toString() : value.replace(/,/g, '').trim();
  if (raw === '' || Number.isNaN(Number(raw))) return null;
  const dot = raw.indexOf('.');
  return { num: Number(raw), decimals: dot >= 0 ? raw.length - dot - 1 : 0 };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// Animates a KPI value with an ease-out count-up (500–700ms). Runs once on mount
// (0 → value) and again only when the target value actually changes. Reused by
// every KPI card. Driven by timed ticks (converges even when rAF is throttled),
// respects prefers-reduced-motion, and always settles on the exact value.
//
// The wrapping <span> is styling-inert but carries the FINAL formatted value
// (`data-final`) and a settled flag (`data-settled`) so the Executive Export
// Center can (a) wait until every counter has finished and (b) substitute the
// exact final number during capture — exported reports can never show a
// mid-animation value.
export default function AnimatedNumber({ value, duration = 600 }: { value: string | number; duration?: number }) {
  const parsed = parse(value);
  const target = parsed ? parsed.num : 0;
  const decimals = parsed ? parsed.decimals : 0;
  const [display, setDisplay] = useState(0);
  const [settled, setSettled] = useState(false);
  const currentRef = useRef(0);

  useEffect(() => {
    if (!parsed) return;
    const to = target;
    const from = currentRef.current;
    if (from === to) { setDisplay(to); setSettled(true); return; }

    const reduce = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { currentRef.current = to; setDisplay(to); setSettled(true); return; }

    setSettled(false);
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const v = from + (to - from) * easeOut(t);
      currentRef.current = v;
      setDisplay(v);
      if (t < 1) timer = setTimeout(tick, 16);
      else { currentRef.current = to; setDisplay(to); setSettled(true); }
    };
    tick();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const format = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  if (!parsed) return <>{value}</>;
  return (
    <span data-animated-number data-final={format(target)} data-settled={settled ? 'true' : 'false'}>
      {format(display)}
    </span>
  );
}
