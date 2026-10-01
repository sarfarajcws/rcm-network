import { Prisma, prisma } from '../../lib/prisma.js';
import { currentYearMonth, parseYmKey, type YearMonth, ymKey } from '../../lib/months.js';
import { validationError } from '../../lib/errors.js';

/**
 * Months the UI can choose from: every month that has PV data, plus the current
 * calendar month (so a brand-new month can be worked on before any import).
 */
export async function availableMonths() {
  const rows = await prisma.$queryRaw<{ year: number; month: number }[]>(Prisma.sql`
    SELECT DISTINCT year, month FROM "MonthlyPv" ORDER BY year DESC, month DESC
  `);
  const current = currentYearMonth();
  const keys = new Set(rows.map((r) => ymKey(r)));
  keys.add(ymKey(current));
  const latestWithData = rows[0] ? ymKey(rows[0]) : null;
  return {
    current: ymKey(current),
    latestWithData,
    available: [...keys].sort().reverse(),
  };
}

/** Month from a "YYYY-MM" query string, or the latest month with data, or the calendar month. */
export async function resolveMonth(raw: unknown): Promise<YearMonth> {
  if (typeof raw === 'string' && raw.length) {
    const ym = parseYmKey(raw);
    if (!ym) throw validationError('month must be in YYYY-MM format');
    return ym;
  }
  const latest = await prisma.monthlyPv.findFirst({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: { year: true, month: true },
  });
  return latest ?? currentYearMonth();
}
