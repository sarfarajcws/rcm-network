/**
 * PV engine — authoritative group/downline PV calculation.
 *
 * Rules (from the specification):
 *  - Each AB has its own Self PV per month (MonthlyPv).
 *  - Each direct Sponsor child heads one leg/group. There is no limit on legs.
 *  - A leg's PV is the sum of Self PV of every member in that child's subtree
 *    (the child included). PV only flows up the sponsor chain, so unrelated
 *    branches never contribute.
 *  - Total PV = Self PV + sum of all leg PVs.
 */
import { Prisma, prisma, type Db } from '../../lib/prisma.js';
import { type YearMonth, ymKey } from '../../lib/months.js';
import { legAggregates, monthlyLegHistory } from '../network/network.repo.js';

export interface LegPv {
  index: number; // 1-based, stable order
  memberId: string;
  abNumber: string;
  name: string;
  status: string;
  kycStatus: string;
  legSize: number; // members in the leg including its head
  pv: number;
}

export interface PvBreakdown {
  month: string; // "2026-10"
  selfPv: number;
  legs: LegPv[];
  groupPv: number;
  totalPv: number;
}

export interface NetworkSummary {
  directLegs: number;
  totalDownline: number;
  active: number;
  terminated: number;
  kycNotOk: number;
}

/** Stable leg order: earliest joiner first (Leg 1, Leg 2, ...). */
export const LEG_ORDER = [
  { joiningDate: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
  { abNumber: 'asc' },
] as const satisfies Prisma.MemberOrderByWithRelationInput[];

async function directChildren(db: Db, memberId: string) {
  return db.member.findMany({
    where: { sponsorId: memberId },
    select: { id: true, abNumber: true, name: true, status: true, kycStatus: true, createdAt: true },
    orderBy: LEG_ORDER,
  });
}

export async function selfPv(db: Db, memberId: string, ym: YearMonth): Promise<number> {
  const row = await db.monthlyPv.findUnique({
    where: { memberId_year_month: { memberId, year: ym.year, month: ym.month } },
    select: { selfPv: true },
  });
  return row ? Number(row.selfPv) : 0;
}

/** PV breakdown + network summary for one member in one month (3 queries total). */
export async function pvBreakdownWithSummary(
  memberId: string,
  ym: YearMonth,
  db: Db = prisma,
): Promise<{ pv: PvBreakdown; summary: NetworkSummary }> {
  const [children, aggregates, self] = await Promise.all([
    directChildren(db, memberId),
    legAggregates(db, memberId, ym),
    selfPv(db, memberId, ym),
  ]);
  const byLeg = new Map(aggregates.map((a) => [a.legId, a]));

  const legs: LegPv[] = children.map((c, i) => {
    const agg = byLeg.get(c.id);
    return {
      index: i + 1,
      memberId: c.id,
      abNumber: c.abNumber,
      name: c.name,
      status: c.status,
      kycStatus: c.kycStatus,
      legSize: agg?.size ?? 1,
      pv: agg?.pv ?? 0,
    };
  });
  const groupPv = round2(legs.reduce((s, l) => s + l.pv, 0));

  const summary: NetworkSummary = {
    directLegs: children.length,
    totalDownline: aggregates.reduce((s, a) => s + a.size, 0),
    active: aggregates.reduce((s, a) => s + a.active, 0),
    terminated: aggregates.reduce((s, a) => s + a.terminated, 0),
    kycNotOk: aggregates.reduce((s, a) => s + a.kycNotOk, 0),
  };

  return {
    pv: { month: ymKey(ym), selfPv: self, legs, groupPv, totalPv: round2(self + groupPv) },
    summary,
  };
}

export interface PvHistoryMonth {
  month: string;
  selfPv: number;
  legs: { memberId: string; pv: number }[];
  groupPv: number;
  totalPv: number;
}

/**
 * Month-wise history: every month in which the member or anyone in its downline
 * has PV. Legs are reported for the member's *current* direct children.
 */
export async function pvHistory(memberId: string, db: Db = prisma) {
  const [children, rows] = await Promise.all([directChildren(db, memberId), monthlyLegHistory(db, memberId)]);
  const months = new Map<string, PvHistoryMonth>();
  const get = (year: number, month: number) => {
    const key = ymKey({ year, month });
    let m = months.get(key);
    if (!m) {
      m = { month: key, selfPv: 0, legs: children.map((c) => ({ memberId: c.id, pv: 0 })), groupPv: 0, totalPv: 0 };
      months.set(key, m);
    }
    return m;
  };
  const legIndex = new Map(children.map((c, i) => [c.id, i]));
  for (const r of rows) {
    const m = get(r.year, r.month);
    if (r.legId === null) m.selfPv = r.pv;
    else {
      const idx = legIndex.get(r.legId);
      if (idx !== undefined) m.legs[idx]!.pv = r.pv;
    }
  }
  for (const m of months.values()) {
    m.groupPv = round2(m.legs.reduce((s, l) => s + l.pv, 0));
    m.totalPv = round2(m.selfPv + m.groupPv);
  }
  return {
    legs: children.map((c, i) => ({ index: i + 1, memberId: c.id, abNumber: c.abNumber, name: c.name })),
    months: [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
  };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
