import { CalendarDays } from 'lucide-react';
import { useMonth } from '../hooks/useMonth';
import { monthLabel } from '../utils/format';

export function MonthSelect() {
  const { month, setMonth, available, current, latestWithData } = useMonth();
  const note = month === current ? 'Current month' : month === latestWithData ? 'Latest month with PV data' : 'Working month';
  return (
    <label className="relative inline-flex items-center" title={note}>
      <span className="sr-only">Working month</span>
      <CalendarDays className="absolute left-2.5 size-4 text-muted pointer-events-none" />
      <select
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className={`appearance-none rounded-lg border border-line-strong bg-surface pl-8 pr-7 text-sm font-medium min-h-9 focus:outline-none focus:ring-2 focus:ring-leaf/20 `}
      >
        {available.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <svg className="absolute right-2 size-3.5 text-muted pointer-events-none" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
      </svg>
    </label>
  );
}
