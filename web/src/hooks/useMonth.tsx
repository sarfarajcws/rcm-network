import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { metaApi } from '../api/endpoints';
import { currentIstMonthKey } from '../utils/format';

/**
 * The "working month" used across PV screens. Defaults to the latest month that
 * has PV data (so a fresh October with no report yet still opens on September),
 * and can be switched from the header. Remembered per device.
 */
interface MonthState {
  month: string;
  setMonth: (m: string) => void;
  available: string[];
  current: string;
  latestWithData: string | null;
}

const MonthContext = createContext<MonthState | null>(null);
const KEY = 'rcm.month';

export function MonthProvider({ children }: { children: ReactNode }) {
  const months = useQuery({ queryKey: ['months'], queryFn: metaApi.months, staleTime: 60_000 });
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  const value = useMemo<MonthState>(() => {
    const current = months.data?.current ?? currentIstMonthKey();
    const available = months.data?.available ?? [current];
    const month = chosen && available.includes(chosen) ? chosen : (months.data?.latestWithData ?? current);
    return {
      month,
      current,
      available,
      latestWithData: months.data?.latestWithData ?? null,
      setMonth: (m: string) => {
        setChosen(m);
        try {
          sessionStorage.setItem(KEY, m);
        } catch {
          /* ignore */
        }
      },
    };
  }, [months.data, chosen]);

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>;
}

export function useMonth() {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error('useMonth outside MonthProvider');
  return ctx;
}
