import { Prisma, prisma } from '../../lib/prisma.js';
import { monthRange, type YearMonth, ymKey } from '../../lib/months.js';
import { pvBreakdownWithSummary, round2 } from '../pv/pv.engine.js';
import { monthlyJoiningCounts } from '../joinings/joinings.service.js';

function lastMonths(end: YearMonth, n: number): YearMonth[] {
  const out: YearMonth[] = [];
  let { year, month } = end;
  for (let i = 0; i < n; i++) {
    out.unshift({ year, month });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

export async function dashboard(rootMemberId: string, ym: YearMonth) {
  const { start, end } = monthRange(ym);
  const trendMonths = lastMonths(ym, 6);
  const first = trendMonths[0]!;

  const [{ pv, summary }, unmapped, joinMembers, joinUnmapped, lastImport, pvTrendRows, joinTrend, zeroPv] =
    await Promise.all([
      pvBreakdownWithSummary(rootMemberId, ym),
      prisma.unmappedRecord.count(),
      prisma.member.count({ where: { joiningDate: { gte: start, lt: end } } }),
      prisma.unmappedRecord.count({ where: { joiningDate: { gte: start, lt: end } } }),
      prisma.importBatch.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.$queryRaw<{ year: number; month: number; pv: string }[]>(Prisma.sql`
        SELECT year, month, sum("selfPv")::text AS pv FROM "MonthlyPv"
        WHERE (year * 12 + month) BETWEEN ${first.year * 12 + first.month} AND ${ym.year * 12 + ym.month}
        GROUP BY year, month
      `),
      monthlyJoiningCounts(ym, 6),
      prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM "Member" m
        LEFT JOIN "MonthlyPv" p ON p."memberId" = m.id AND p.year = ${ym.year} AND p.month = ${ym.month}
        WHERE m.status = 'ACTIVE' AND COALESCE(p."selfPv", 0) = 0
      `),
    ]);

  const pvByMonth = new Map(pvTrendRows.map((r) => [ymKey(r), Number(r.pv)]));

  return {
    month: ymKey(ym),
    network: {
      totalMembers: summary.totalDownline + 1, // downline + the Main Leader
      downline: summary.totalDownline,
      active: summary.active,
      terminated: summary.terminated,
      kycNotOk: summary.kycNotOk,
      directLegs: summary.directLegs,
      activeWithZeroPv: zeroPv[0]?.n ?? 0,
    },
    pv: {
      selfPv: pv.selfPv,
      groupPv: pv.groupPv,
      totalPv: pv.totalPv,
      legs: pv.legs,
    },
    joinings: { thisMonth: joinMembers + joinUnmapped, mapped: joinMembers, unmapped: joinUnmapped },
    unmappedCount: unmapped,
    lastImport: lastImport
      ? {
          id: lastImport.id,
          fileName: lastImport.fileName,
          status: lastImport.status,
          at: lastImport.startedAt,
          matched: lastImport.matchedCount,
          unmapped: lastImport.unmappedCount,
        }
      : null,
    trend: trendMonths.map((m) => ({
      month: ymKey(m),
      pv: round2(pvByMonth.get(ymKey(m)) ?? 0),
      joinings: joinTrend.find((j) => j.month === ymKey(m))?.count ?? 0,
    })),
  };
}
