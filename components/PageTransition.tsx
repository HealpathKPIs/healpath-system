'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Subtle Linear/Vercel/Stripe-style page transition: a short fade + slight
// upward motion on page navigation. Keyed on pathname so it plays only when the
// page changes — not on every filter/search/cross-filter URL update.
const CSS = `
.page-enter { animation: pageEnter 210ms cubic-bezier(0.16, 1, 0.3, 1) both; will-change: opacity, transform; }
@keyframes pageEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .page-enter { animation: none; } }
`;

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <style>{CSS}</style>
      <div key={pathname} className="page-enter">{children}</div>
    </>
  );
}
