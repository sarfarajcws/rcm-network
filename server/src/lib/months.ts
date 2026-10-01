export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-04" */
export function ymKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

export function parseYmKey(key: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

export function ymLabel(ym: YearMonth): string {
  return `${MONTH_NAMES[ym.month - 1]} ${ym.year}`;
}

/** Current calendar month in India Standard Time (the business timezone). */
export function currentYearMonth(now = new Date()): YearMonth {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

/** Indian financial year start: April. Jan-Mar belong to the previous FY start. */
export function financialYearStart(ym: YearMonth): number {
  return ym.month >= 4 ? ym.year : ym.year - 1;
}

/** Calendar year of a month inside a financial year (Apr..Dec -> fy, Jan..Mar -> fy+1). */
export function yearForFyMonth(fyStartYear: number, month: number): number {
  return month >= 4 ? fyStartYear : fyStartYear + 1;
}

/** Map a header like "April", "Apr", "APR-26" to month number. */
export function monthFromHeader(header: string): number | null {
  const h = header.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!h) return null;
  for (let i = 0; i < 12; i++) {
    const full = MONTH_NAMES[i]!.toLowerCase();
    if (h === full || h === full.slice(0, 3) || (h === 'sept' && i === 8)) return i + 1;
  }
  return null;
}

export function monthRange(ym: YearMonth): { start: Date; end: Date } {
  const start = new Date(Date.UTC(ym.year, ym.month - 1, 1));
  const end = new Date(Date.UTC(ym.year, ym.month, 1));
  return { start, end };
}
