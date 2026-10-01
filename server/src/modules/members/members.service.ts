import { badRequest, conflict, notFound, validationError } from '../../lib/errors.js';
import { Prisma, prisma, type Db, type Member, type Tx } from '../../lib/prisma.js';
import { parseYmKey, type YearMonth, ymKey } from '../../lib/months.js';
import { ancestors, descendantsCte, isSelfOrAncestor, lockSponsorGraph } from '../network/network.repo.js';
import { pvBreakdownWithSummary } from '../pv/pv.engine.js';
import type { ListMembersQuery } from './members.schemas.js';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

type MemberWithRefs = Member & {
  sponsor?: { abNumber: string; name: string } | null;
  proposer?: { abNumber: string; name: string } | null;
  user?: { id: string } | null;
};

export function toMemberDto(m: MemberWithRefs) {
  return {
    id: m.id,
    abNumber: m.abNumber,
    name: m.name,
    kycStatus: m.kycStatus,
    status: m.status,
    isMainLeader: Boolean(m.user),
    sponsor: m.sponsor ? { abNumber: m.sponsor.abNumber, name: m.sponsor.name } : null,
    proposer: m.proposer ? { abNumber: m.proposer.abNumber, name: m.proposer.name } : null,
    external: {
      sponsorAbNumber: m.externalSponsorAbNumber,
      sponsorName: m.externalSponsorName,
      proposerAbNumber: m.externalProposerAbNumber,
      proposerName: m.externalProposerName,
    },
    report: {
      joiningDate: m.joiningDate ? m.joiningDate.toISOString().slice(0, 10) : null,
      mobile: m.mobile,
      city: m.city,
      district: m.district,
      state: m.state,
      proposerAbNumber: m.reportProposerAbNumber,
      proposerName: m.reportProposerName,
      pucHomeDelivery: m.pucHomeDelivery,
      displayWall: m.displayWall,
      updatedAt: m.reportUpdatedAt,
    },
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

const refInclude = {
  sponsor: { select: { abNumber: true, name: true } },
  proposer: { select: { abNumber: true, name: true } },
  user: { select: { id: true } },
} as const;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export async function findMemberOrThrow(db: Db, abNumber: string) {
  const m = await db.member.findUnique({ where: { abNumber }, include: refInclude });
  if (!m) throw notFound(`AB ${abNumber} does not exist in the network`);
  return m;
}

async function resolveReference(db: Db, abNumber: string, label: 'Sponsor' | 'Proposer') {
  const m = await db.member.findUnique({ where: { abNumber }, select: { id: true, abNumber: true } });
  if (!m) throw validationError(`${label} AB ${abNumber} does not exist in the network`, { field: label.toLowerCase() });
  return m;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateMemberInput {
  abNumber: string;
  name: string;
  kycStatus: 'OK' | 'NOT_OK';
  status: 'ACTIVE' | 'TERMINATED';
  sponsorAbNumber: string;
  proposerAbNumber?: string | null;
}

/**
 * Moves a pending UnmappedRecord (report data + monthly PV from earlier imports)
 * onto a newly created member and removes the pending record.
 */
export async function absorbUnmappedRecord(tx: Tx, memberId: string, abNumber: string) {
  const rec = await tx.unmappedRecord.findUnique({ where: { abNumber } });
  if (!rec) return false;
  await tx.member.update({
    where: { id: memberId },
    data: {
      joiningDate: rec.joiningDate,
      mobile: rec.mobile,
      city: rec.city,
      district: rec.district,
      state: rec.state,
      reportProposerAbNumber: rec.proposerAbNumber,
      reportProposerName: rec.proposerName,
      pucHomeDelivery: rec.pucHomeDelivery,
      displayWall: rec.displayWall,
      reportUpdatedAt: rec.lastSeenAt,
      lastImportId: rec.lastImportId,
    },
  });
  const pv = (rec.monthlyPv ?? {}) as Record<string, number>;
  const rows = Object.entries(pv)
    .map(([k, v]) => ({ ym: parseYmKey(k), v: Number(v) }))
    .filter((r): r is { ym: YearMonth; v: number } => r.ym !== null && Number.isFinite(r.v) && r.v >= 0);
  if (rows.length) {
    await tx.monthlyPv.createMany({
      data: rows.map((r) => ({
        memberId,
        year: r.ym.year,
        month: r.ym.month,
        selfPv: r.v,
        source: 'EXCEL' as const,
        importId: rec.lastImportId,
      })),
      skipDuplicates: true,
    });
    await tx.pvAuditLog.createMany({
      data: rows.map((r) => ({
        memberId,
        year: r.ym.year,
        month: r.ym.month,
        oldPv: null,
        newPv: r.v,
        source: 'EXCEL' as const,
        importId: rec.lastImportId,
      })),
    });
  }
  await tx.unmappedRecord.delete({ where: { id: rec.id } });
  return true;
}

export async function createMember(input: CreateMemberInput) {
  if (input.sponsorAbNumber === input.abNumber) throw validationError('An AB cannot be its own Sponsor');
  if (input.proposerAbNumber && input.proposerAbNumber === input.abNumber)
    throw validationError('An AB cannot be its own Proposer');

  try {
    return await prisma.$transaction(async (tx) => {
      await lockSponsorGraph(tx);
      const existing = await tx.member.findUnique({ where: { abNumber: input.abNumber }, select: { name: true } });
      if (existing) {
        throw conflict(`AB ${input.abNumber} already exists (${existing.name}). Duplicate ABs are not allowed.`, 'DUPLICATE_AB');
      }
      const sponsor = await resolveReference(tx, input.sponsorAbNumber, 'Sponsor');
      const proposer = input.proposerAbNumber ? await resolveReference(tx, input.proposerAbNumber, 'Proposer') : null;

      const created = await tx.member.create({
        data: {
          abNumber: input.abNumber,
          name: input.name,
          kycStatus: input.kycStatus,
          status: input.status,
          sponsorId: sponsor.id,
          proposerId: proposer?.id ?? null,
        },
      });
      const absorbed = await absorbUnmappedRecord(tx, created.id, input.abNumber);
      const full = await tx.member.findUniqueOrThrow({ where: { id: created.id }, include: refInclude });
      return { member: toMemberDto(full), absorbedUnmapped: absorbed };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict(`AB ${input.abNumber} already exists. Duplicate ABs are not allowed.`, 'DUPLICATE_AB');
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateMemberInput {
  name?: string;
  kycStatus?: 'OK' | 'NOT_OK';
  status?: 'ACTIVE' | 'TERMINATED';
  sponsorAbNumber?: string;
  proposerAbNumber?: string | null;
  externalSponsorAbNumber?: string | null;
  externalSponsorName?: string | null;
  externalProposerAbNumber?: string | null;
  externalProposerName?: string | null;
}

export async function updateMember(abNumber: string, input: UpdateMemberInput, rootMemberId: string) {
  return prisma.$transaction(async (tx) => {
    const member = await findMemberOrThrow(tx, abNumber);
    const isRoot = member.id === rootMemberId;
    const data: Prisma.MemberUncheckedUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.kycStatus !== undefined) data.kycStatus = input.kycStatus;
    if (input.status !== undefined) data.status = input.status;

    if (input.sponsorAbNumber !== undefined) {
      if (isRoot) throw badRequest('The Main Leader is the root of the network and cannot have a Sponsor inside it.');
      if (input.sponsorAbNumber === abNumber) throw validationError('An AB cannot be its own Sponsor');
      await lockSponsorGraph(tx);
      const sponsor = await resolveReference(tx, input.sponsorAbNumber, 'Sponsor');
      // Cycle check: the new sponsor must not be this member or anyone below it.
      if (await isSelfOrAncestor(tx, member.id, sponsor.id)) {
        throw validationError(
          `AB ${input.sponsorAbNumber} is in the downline of AB ${abNumber}. Making it the Sponsor would create a loop in the tree.`,
          { code: 'SPONSOR_CYCLE' },
        );
      }
      data.sponsorId = sponsor.id;
    }

    if (input.proposerAbNumber !== undefined) {
      if (input.proposerAbNumber === null) data.proposerId = null;
      else {
        if (input.proposerAbNumber === abNumber) throw validationError('An AB cannot be its own Proposer');
        data.proposerId = (await resolveReference(tx, input.proposerAbNumber, 'Proposer')).id;
      }
    }

    const externalKeys = [
      'externalSponsorAbNumber',
      'externalSponsorName',
      'externalProposerAbNumber',
      'externalProposerName',
    ] as const;
    for (const k of externalKeys) {
      if (input[k] !== undefined) {
        if (!isRoot) throw badRequest('External upline details apply to the Main Leader only.');
        data[k] = input[k] || null;
      }
    }

    const updated = await tx.member.update({ where: { id: member.id }, data, include: refInclude });
    return toMemberDto(updated);
  });
}

// ---------------------------------------------------------------------------
// Delete (only leaf members created by mistake)
// ---------------------------------------------------------------------------

export async function deleteMember(abNumber: string, rootMemberId: string) {
  return prisma.$transaction(async (tx) => {
    await lockSponsorGraph(tx);
    const member = await findMemberOrThrow(tx, abNumber);
    if (member.id === rootMemberId) throw badRequest('The Main Leader cannot be deleted.');
    const children = await tx.member.count({ where: { sponsorId: member.id } });
    if (children > 0) {
      throw conflict(
        `AB ${abNumber} sponsors ${children} member(s). Move them to another Sponsor before deleting.`,
        'HAS_DOWNLINE',
      );
    }
    await tx.member.delete({ where: { id: member.id } });
    return { deleted: abNumber };
  });
}

// ---------------------------------------------------------------------------
// Search (typeahead) and list (filters)
// ---------------------------------------------------------------------------

function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchMembers(q: string, limit = 10) {
  const term = q.trim();
  if (!term) return [];
  const digits = /^\d+$/.test(term);
  const rows = await prisma.$queryRaw<
    { abNumber: string; name: string; status: string; kycStatus: string; rank: number }[]
  >(Prisma.sql`
    SELECT m."abNumber", m.name, m.status, m."kycStatus",
      CASE WHEN m."abNumber" = ${term} THEN 0
           WHEN m."abNumber" LIKE ${likeEscape(term) + '%'} THEN 1
           WHEN lower(m.name) LIKE lower(${likeEscape(term) + '%'}) THEN 2
           ELSE 3 END AS rank
    FROM "Member" m
    WHERE ${
      digits
        ? Prisma.sql`m."abNumber" LIKE ${likeEscape(term) + '%'}`
        : Prisma.sql`m.name ILIKE ${'%' + likeEscape(term) + '%'}`
    }
    ORDER BY rank, m.name
    LIMIT ${limit}
  `);
  return rows.map(({ rank: _r, ...r }) => r);
}

const PV_PRESETS: Record<string, [number | null, number | null, boolean]> = {
  // [min, max, minExclusive]
  ZERO: [0, 0, false],
  '0-100': [0, 100, true],
  '100-500': [100, 500, true],
  '500-1000': [500, 1000, true],
  '1000-5000': [1000, 5000, true],
  '5000+': [5000, null, true],
};

export async function listMembers(query: ListMembersQuery, defaultMonth: YearMonth) {
  const ym = query.month ? parseYmKey(query.month)! : defaultMonth;
  const conds: Prisma.Sql[] = [];

  if (query.status !== 'ALL') conds.push(Prisma.sql`m.status = ${query.status}::"MemberStatus"`);
  if (query.kyc !== 'ALL') conds.push(Prisma.sql`m."kycStatus" = ${query.kyc}::"KycStatus"`);

  const pvExpr = Prisma.sql`COALESCE(p."selfPv", 0)`;
  if (query.pv === 'CUSTOM') {
    if (query.pvMin !== undefined) conds.push(Prisma.sql`${pvExpr} >= ${query.pvMin}`);
    if (query.pvMax !== undefined) conds.push(Prisma.sql`${pvExpr} <= ${query.pvMax}`);
    if (query.pvMin !== undefined && query.pvMax !== undefined && query.pvMin > query.pvMax)
      throw validationError('Minimum PV cannot be greater than maximum PV');
  } else if (query.pv !== 'ALL') {
    const [min, max, minExclusive] = PV_PRESETS[query.pv]!;
    if (min !== null) conds.push(minExclusive ? Prisma.sql`${pvExpr} > ${min}` : Prisma.sql`${pvExpr} >= ${min}`);
    if (max !== null) conds.push(Prisma.sql`${pvExpr} <= ${max}`);
  }

  if (query.q) {
    const term = query.q.trim();
    if (/^\d+$/.test(term)) conds.push(Prisma.sql`m."abNumber" LIKE ${likeEscape(term) + '%'}`);
    else conds.push(Prisma.sql`m.name ILIKE ${'%' + likeEscape(term) + '%'}`);
  }

  let withClause = Prisma.empty;
  if (query.under) {
    const head = await prisma.member.findUnique({ where: { abNumber: query.under }, select: { id: true } });
    if (!head) throw notFound(`AB ${query.under} does not exist`);
    withClause = Prisma.sql`WITH ${descendantsCte(head.id)}`;
    conds.push(Prisma.sql`m.id IN (SELECT id FROM scope)`);
  }

  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  const sortCol = {
    abNumber: Prisma.sql`length(m."abNumber"), m."abNumber"`,
    name: Prisma.sql`lower(m.name)`,
    pv: pvExpr,
    joiningDate: Prisma.sql`m."joiningDate"`,
  }[query.sort];
  const dir = query.dir === 'desc' ? Prisma.raw('DESC NULLS LAST') : Prisma.raw('ASC NULLS LAST');
  const offset = (query.page - 1) * query.pageSize;

  const rows = await prisma.$queryRaw<
    {
      abNumber: string;
      name: string;
      status: string;
      kycStatus: string;
      joiningDate: Date | null;
      mobile: string | null;
      city: string | null;
      district: string | null;
      sponsorAbNumber: string | null;
      sponsorName: string | null;
      pv: string;
      total: number;
      totalPv: string;
    }[]
  >(Prisma.sql`
    ${withClause}
    SELECT m."abNumber", m.name, m.status, m."kycStatus", m."joiningDate", m.mobile, m.city, m.district,
           s."abNumber" AS "sponsorAbNumber", s.name AS "sponsorName",
           ${pvExpr}::text AS pv,
           (count(*) OVER ())::int AS total,
           (sum(${pvExpr}) OVER ())::text AS "totalPv"
    FROM "Member" m
    LEFT JOIN "Member" s ON s.id = m."sponsorId"
    LEFT JOIN "MonthlyPv" p ON p."memberId" = m.id AND p.year = ${ym.year} AND p.month = ${ym.month}
    ${where}
    ORDER BY ${sortCol} ${dir}, m."abNumber" ASC
    LIMIT ${query.pageSize} OFFSET ${offset}
  `);

  // When the requested page is beyond the end, still report the total.
  let total = rows[0]?.total ?? 0;
  let totalPv = Number(rows[0]?.totalPv ?? 0);
  if (rows.length === 0 && query.page > 1) {
    const agg = await prisma.$queryRaw<{ total: number; totalPv: string }[]>(Prisma.sql`
      ${withClause}
      SELECT count(*)::int AS total, COALESCE(sum(${pvExpr}),0)::text AS "totalPv"
      FROM "Member" m
      LEFT JOIN "MonthlyPv" p ON p."memberId" = m.id AND p.year = ${ym.year} AND p.month = ${ym.month}
      ${where}
    `);
    total = agg[0]?.total ?? 0;
    totalPv = Number(agg[0]?.totalPv ?? 0);
  }

  return {
    month: ymKey(ym),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPv,
    items: rows.map(({ total: _t, totalPv: _tp, ...r }) => ({
      ...r,
      pv: Number(r.pv),
      joiningDate: r.joiningDate ? r.joiningDate.toISOString().slice(0, 10) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(abNumber: string, ym: YearMonth, rootMemberId: string) {
  const member = await findMemberOrThrow(prisma, abNumber);
  const [{ pv, summary }, path, joiningCount] = await Promise.all([
    pvBreakdownWithSummary(member.id, ym),
    ancestors(prisma, member.id),
    countJoinings(member.id, member.abNumber),
  ]);
  // Path from Main Leader down to this member (excluding the member itself).
  const rootIdx = path.findIndex((p) => p.id === rootMemberId);
  const upline = (rootIdx >= 0 ? path.slice(1, rootIdx + 1) : path.slice(1)).reverse();
  return {
    member: toMemberDto(member),
    depth: rootIdx >= 0 ? rootIdx : null,
    upline: upline.map((p) => ({ abNumber: p.abNumber, name: p.name })),
    summary,
    pv,
    joinings: { total: joiningCount },
  };
}

async function countJoinings(memberId: string, abNumber: string) {
  const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT (
      (SELECT count(*) FROM "Member" m
        WHERE m."proposerId" = ${memberId}
           OR (m."proposerId" IS NULL AND m."reportProposerAbNumber" = ${abNumber}))
      +
      (SELECT count(*) FROM "UnmappedRecord" u WHERE u."proposerAbNumber" = ${abNumber})
    )::int AS n
  `);
  return rows[0]?.n ?? 0;
}
