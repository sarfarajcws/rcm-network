/**
 * Sponsor-tree engine.
 *
 * Every aggregate here is derived from Member.sponsorId with PostgreSQL recursive
 * CTEs — counts and group PV are never stored, so they are always consistent with
 * the current tree. The CTEs use UNION (not UNION ALL) so they terminate even if a
 * cycle ever slipped into the data; cycles are additionally prevented on write.
 */
import { Prisma, type Db } from '../../lib/prisma.js';
import type { YearMonth } from '../../lib/months.js';

/** Serialise all sponsor-relationship writes so concurrent edits cannot form a cycle. */
export const SPONSOR_LOCK_KEY = 7_362_001;

export async function lockSponsorGraph(tx: Db) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SPONSOR_LOCK_KEY})`;
}

export interface LegAggregate {
  legId: string;
  size: number; // members in this leg including the leg's head
  active: number;
  terminated: number;
  kycNotOk: number;
  pv: number; // sum of Self PV of every member in the leg for the month
}

/**
 * For each direct child (leg) of `parentId`: how many members are in that leg,
 * their status counts and the leg's total PV for the month.
 */
export async function legAggregates(db: Db, parentId: string, ym: YearMonth): Promise<LegAggregate[]> {
  const rows = await db.$queryRaw<
    { legId: string; size: number; active: number; terminated: number; kycNotOk: number; pv: string }[]
  >(Prisma.sql`
    WITH RECURSIVE sub AS (
      SELECT c.id, c.id AS leg FROM "Member" c WHERE c."sponsorId" = ${parentId}
      UNION
      SELECT m.id, s.leg FROM "Member" m JOIN sub s ON m."sponsorId" = s.id
    )
    SELECT s.leg AS "legId",
           count(*)::int AS "size",
           (count(*) FILTER (WHERE mm.status = 'ACTIVE'))::int AS "active",
           (count(*) FILTER (WHERE mm.status = 'TERMINATED'))::int AS "terminated",
           (count(*) FILTER (WHERE mm."kycStatus" = 'NOT_OK'))::int AS "kycNotOk",
           COALESCE(sum(p."selfPv"), 0)::text AS "pv"
    FROM sub s
    JOIN "Member" mm ON mm.id = s.id
    LEFT JOIN "MonthlyPv" p ON p."memberId" = s.id AND p.year = ${ym.year} AND p.month = ${ym.month}
    GROUP BY s.leg
  `);
  return rows.map((r) => ({ ...r, pv: Number(r.pv) }));
}

/** Same as legAggregates but for many parents at once (used by tree children). */
export async function subtreeTotalsFor(
  db: Db,
  headIds: string[],
  ym: YearMonth,
): Promise<Map<string, { size: number; pv: number }>> {
  if (headIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ head: string; size: number; pv: string }[]>(Prisma.sql`
    WITH RECURSIVE sub AS (
      SELECT h.id, h.id AS head FROM "Member" h WHERE h.id IN (${Prisma.join(headIds)})
      UNION
      SELECT m.id, s.head FROM "Member" m JOIN sub s ON m."sponsorId" = s.id
    )
    SELECT s.head, count(*)::int AS "size", COALESCE(sum(p."selfPv"), 0)::text AS "pv"
    FROM sub s
    LEFT JOIN "MonthlyPv" p ON p."memberId" = s.id AND p.year = ${ym.year} AND p.month = ${ym.month}
    GROUP BY s.head
  `);
  return new Map(rows.map((r) => [r.head, { size: r.size, pv: Number(r.pv) }]));
}

export interface LegMonthRow {
  legId: string | null; // null = the member's own Self PV
  year: number;
  month: number;
  pv: number;
}

/** Month-wise Self PV and per-leg PV for a member across every month with data. */
export async function monthlyLegHistory(db: Db, memberId: string): Promise<LegMonthRow[]> {
  const rows = await db.$queryRaw<{ legId: string | null; year: number; month: number; pv: string }[]>(Prisma.sql`
    WITH RECURSIVE sub AS (
      SELECT c.id, c.id AS leg FROM "Member" c WHERE c."sponsorId" = ${memberId}
      UNION
      SELECT m.id, s.leg FROM "Member" m JOIN sub s ON m."sponsorId" = s.id
    )
    SELECT s.leg AS "legId", p.year, p.month, sum(p."selfPv")::text AS "pv"
    FROM sub s JOIN "MonthlyPv" p ON p."memberId" = s.id
    GROUP BY s.leg, p.year, p.month
    UNION ALL
    SELECT NULL AS "legId", p.year, p.month, p."selfPv"::text AS "pv"
    FROM "MonthlyPv" p WHERE p."memberId" = ${memberId}
  `);
  return rows.map((r) => ({ ...r, pv: Number(r.pv) }));
}

export interface AncestorRow {
  id: string;
  abNumber: string;
  name: string;
  depth: number; // 0 = the member itself, 1 = sponsor, ...
}

/** Chain from the member up to the top of the tree. */
export async function ancestors(db: Db, memberId: string): Promise<AncestorRow[]> {
  return db.$queryRaw<AncestorRow[]>(Prisma.sql`
    WITH RECURSIVE up AS (
      SELECT id, "sponsorId", 0 AS depth FROM "Member" WHERE id = ${memberId}
      UNION
      SELECT m.id, m."sponsorId", up.depth + 1 FROM "Member" m JOIN up ON m.id = up."sponsorId"
      WHERE up.depth < 100000
    )
    SELECT up.id, mm."abNumber", mm.name, up.depth::int AS depth
    FROM up JOIN "Member" mm ON mm.id = up.id
    ORDER BY up.depth ASC
  `);
}

/** True when `candidateAncestorId` is `memberId` itself or anywhere above it. */
export async function isSelfOrAncestor(db: Db, candidateAncestorId: string, memberId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ found: boolean }[]>(Prisma.sql`
    WITH RECURSIVE up AS (
      SELECT id, "sponsorId" FROM "Member" WHERE id = ${memberId}
      UNION
      SELECT m.id, m."sponsorId" FROM "Member" m JOIN up ON m.id = up."sponsorId"
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE id = ${candidateAncestorId}) AS found
  `);
  return Boolean(rows[0]?.found);
}

/** SQL fragment: ids of every descendant of `rootId` (excluding the root). */
export function descendantsCte(rootId: string) {
  return Prisma.sql`
    RECURSIVE scope AS (
      SELECT c.id FROM "Member" c WHERE c."sponsorId" = ${rootId}
      UNION
      SELECT m.id FROM "Member" m JOIN scope s ON m."sponsorId" = s.id
    )`;
}
