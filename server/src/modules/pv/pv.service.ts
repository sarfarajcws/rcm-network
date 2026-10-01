import { validationError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { currentYearMonth, type YearMonth, ymKey } from '../../lib/months.js';
import { findMemberOrThrow } from '../members/members.service.js';

export async function lookupPv(abNumber: string, ym: YearMonth) {
  const member = await findMemberOrThrow(prisma, abNumber);
  const row = await prisma.monthlyPv.findUnique({
    where: { memberId_year_month: { memberId: member.id, year: ym.year, month: ym.month } },
  });
  return {
    abNumber: member.abNumber,
    name: member.name,
    status: member.status,
    kycStatus: member.kycStatus,
    month: ymKey(ym),
    currentPv: row ? Number(row.selfPv) : 0,
    hasRecord: Boolean(row),
    source: row?.source ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

function assertNotFuture(ym: YearMonth) {
  const cur = currentYearMonth();
  if (ym.year > cur.year || (ym.year === cur.year && ym.month > cur.month)) {
    throw validationError('PV cannot be recorded for a future month');
  }
}

/**
 * Manual PV update. The new value OVERWRITES the month's Self PV (it is never
 * added to the existing value). Sponsor/Proposer relationships are untouched.
 */
export async function manualUpdatePv(abNumber: string, ym: YearMonth, newPv: number) {
  if (!Number.isFinite(newPv) || newPv < 0) throw validationError('PV must be a non-negative number');
  assertNotFuture(ym);
  const value = Math.round(newPv * 100) / 100;

  return prisma.$transaction(async (tx) => {
    const member = await findMemberOrThrow(tx, abNumber);
    const existing = await tx.monthlyPv.findUnique({
      where: { memberId_year_month: { memberId: member.id, year: ym.year, month: ym.month } },
    });
    const oldPv = existing ? Number(existing.selfPv) : null;

    await tx.monthlyPv.upsert({
      where: { memberId_year_month: { memberId: member.id, year: ym.year, month: ym.month } },
      create: { memberId: member.id, year: ym.year, month: ym.month, selfPv: value, source: 'MANUAL' },
      update: { selfPv: value, source: 'MANUAL', importId: null },
    });
    await tx.pvAuditLog.create({
      data: { memberId: member.id, year: ym.year, month: ym.month, oldPv, newPv: value, source: 'MANUAL' },
    });

    return {
      abNumber: member.abNumber,
      name: member.name,
      month: ymKey(ym),
      previousPv: oldPv ?? 0,
      currentPv: value,
    };
  });
}

export async function recentPvAudit(memberId: string, limit = 50) {
  const rows = await prisma.pvAuditLog.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    month: ymKey(r),
    oldPv: r.oldPv === null ? null : Number(r.oldPv),
    newPv: Number(r.newPv),
    source: r.source,
    importId: r.importId,
    at: r.createdAt,
  }));
}
