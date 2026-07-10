'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Chart entrance motion is intentionally first-render only for a browser tab;
  // mark it seen only after the chart entrance itself has actually played.
  useEffect(() => {
    const key = 'hp-chart-motion-seen';
    try {
      if (sessionStorage.getItem(key)) {
        document.documentElement.dataset.motionSeen = 'true';
        return;
      }
      const onAnimationEnd = (event: AnimationEvent) => {
        if (event.animationName !== 'hpChartEnter') return;
        sessionStorage.setItem(key, '1');
        document.documentElement.dataset.motionSeen = 'true';
        document.removeEventListener('animationend', onAnimationEnd, true);
      };
      document.addEventListener('animationend', onAnimationEnd, true);
      return () => document.removeEventListener('animationend', onAnimationEnd, true);
    } catch {
      const onAnimationEnd = (event: AnimationEvent) => {
        if (event.animationName !== 'hpChartEnter') return;
        document.documentElement.dataset.motionSeen = 'true';
        document.removeEventListener('animationend', onAnimationEnd, true);
      };
      document.addEventListener('animationend', onAnimationEnd, true);
      return () => document.removeEventListener('animationend', onAnimationEnd, true);
    }
  }, []);

  return <div key={pathname} className="page-enter">{children}</div>;
}
