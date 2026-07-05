'use client';
// Sprint 16 — cross-filtering interaction infrastructure.
//
// A single global selection shared across the dashboard. Chart clicks emit a
// { type, value } selection here; nothing consumes it to change data yet
// (page-specific cross-filter analytics is a later sprint). This is orthogonal
// to the URL filters (Month/Specialty/Doctor), which keep working unchanged.

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type SelectionType = 'drug' | 'disease' | 'doctor' | 'specialty';

export interface Selection {
  type: SelectionType;
  value: string;
}

interface DashboardState {
  selection: Selection | null;
  /** Toggle a selection: selecting the active {type,value} again clears it. */
  select: (type: SelectionType, value: string) => void;
  setSelection: (selection: Selection | null) => void;
  clear: () => void;
}

// Default is a no-op so `useDashboard()` is safe even outside a provider.
const DashboardContext = createContext<DashboardState>({
  selection: null,
  select: () => {},
  setSelection: () => {},
  clear: () => {},
});

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const select = useCallback((type: SelectionType, value: string) => {
    setSelection((cur) => (cur && cur.type === type && cur.value === value ? null : { type, value }));
  }, []);

  const clear = useCallback(() => setSelection(null), []);

  return (
    <DashboardContext.Provider value={{ selection, select, setSelection, clear }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardState {
  return useContext(DashboardContext);
}
