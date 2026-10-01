/**
 * Joining analytics.
 *
 * Joining Date = the Smart Report's "Feeding Date".
 * The proposer of a joining is the member's network Proposer link when set,
 * otherwise the Proposer AB number reported in the Smart Report.
 * Excel rows that are not yet placed in the tree (UnmappedRecord) are real
 * joinings too, so they are included and flagged `mapped: false`.
 */
import { Prisma, prisma } from '../../lib/prisma.js';
import { monthRange, type YearMonth, ymKey } from '../../lib/months.js';

const joiningsCte = Prisma.sql`
  j AS (
    SELECT m."joiningDate" AS "joiningDate", m."abNumber", m.name, m.status::text AS status,
           m."kycStatus"::text AS "kycStatus", TRUE AS mapped,
           COALESCE(pm."abNumber", m."reportProposerAbNumber") AS "proposerAbNumber",
           COALESCE(pm.name, m."reportProposerName") AS "proposerName"
    FROM "Member" m
    LEFT JOIN "Member" pm ON pm.id = m."proposerId"
    WHERE m."joiningDate" IS NOT NULL
    UNION ALL
    SELECT u."joiningDate", u."abNumber", u.name, NULL, NULL, FALSE,
           u."proposerAbNumber", COALESCE(pu.name, u."proposerName")
    FROM "UnmappedRecord" u
    LEFT JOIN "Member" pu ON pu."abNumber" = u."proposerAbNumber"
    WHERE u."joiningDate" IS NOT NULL
  )`;

type JoiningRow = {
  joiningDate: Date;
  abNumber: string;
  name: string;
  status: string | null;
  kycStatus: string | null;
  mapped: boolean;
  proposerAbNumber: string | null;
  proposerName: string | null;
  proposerInNetwork?: boolean;
};

const toDto = (r: JoiningRow) => ({ ...r, joiningDate: r.joiningDate.toISOString().slice(0, 10) });

function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface JoiningsQuery {
  from: Date;
  to: Date; // exclusive
  proposer?: string;
  q?: string;
  includeUnmapped: boolean;
}

export async function listJoinings(query: JoiningsQuery) {
  const conds: Prisma.Sql[] = [Prisma.sql`j."joiningDate" >= ${query.from}`, Prisma.sql`j."joiningDate" < ${query.to}`];
  if (!query.includeUnmapped) conds.push(Prisma.sql`j.mapped`);
  if (query.proposer) conds.push(Prisma.sql`j."proposerAbNumber" = ${query.proposer}`);
  if (query.q) {
    const t = query.q.trim();
    conds.push(
      /^\d+$/.test(t)
        ? Prisma.sql`j."abNumber" LIKE ${likeEscape(t) + '%'}`
        : Prisma.sql`(j.name ILIKE ${'%' + likeEscape(t) + '%'} OR j."proposerName" ILIKE ${'%' + likeEscape(t) + '%'})`,
    );
  }
  const where = Prisma.join(conds, ' AND ');

  const [items, byProposer] = await Promise.all([
    prisma.$queryRaw<JoiningRow[]>(Prisma.sql`
      WITH ${joiningsCte}
      SELECT j.*, EXISTS (SELECT 1 FROM "Member" x WHERE x."abNumber" = j."proposerAbNumber") AS "proposerInNetwork"
      FROM j WHERE ${where}
      ORDER BY j."joiningDate" DESC, j."abNumber" ASC
      LIMIT 5000
    `),
    prisma.$queryRaw<{ proposerAbNumber: string | null; proposerName: string | null; count: number }[]>(Prisma.sql`
      WITH ${joiningsCte}
      SELECT j."proposerAbNumber", max(j."proposerName") AS "proposerName", count(*)::int AS count
      FROM j WHERE ${where}
      GROUP BY j."proposerAbNumber"
      ORDER BY count DESC, max(j."proposerName") ASC
    `),
  ]);

  return {
    total: items.length,
    mappedCount: items.filter((i) => i.mapped).length,
    unmappedCount: items.filter((i) => !i.mapped).length,
    items: items.map(toDto),
    byProposer,
  };
}

/** Joinings per calendar month for the last `months` months ending at `end`. */
export async function monthlyJoiningCounts(end: YearMonth, months = 12) {
  const startYm = { year: end.year, month: end.month - (months - 1) };
  while (startYm.month < 1) {
    startYm.month += 12;
    startYm.year -= 1;
  }
  const from = monthRange(startYm).start;
  const to = monthRange(end).end;
  const rows = await prisma.$queryRaw<{ y: number; m: number; count: number }[]>(Prisma.sql`
    WITH ${joiningsCte}
    SELECT extract(year FROM j."joiningDate")::int AS y, extract(month FROM j."joiningDate")::int AS m,
           count(*)::int AS count
    FROM j WHERE j."joiningDate" >= ${from} AND j."joiningDate" < ${to}
    GROUP BY 1, 2
  `);
  const map = new Map(rows.map((r) => [ymKey({ year: r.y, month: r.m }), r.count]));
  const out: { month: string; count: number }[] = [];
  const cur = { ...startYm };
  for (let i = 0; i < months; i++) {
    const k = ymKey(cur);
    out.push({ month: k, count: map.get(k) ?? 0 });
    cur.month += 1;
    if (cur.month > 12) {
      cur.month = 1;
      cur.year += 1;
    }
  }
  return out;
}

/** Months (YYYY-MM) that have at least one joining, newest first. */
export async function joiningMonths() {
  const rows = await prisma.$queryRaw<{ y: number; m: number }[]>(Prisma.sql`
    WITH ${joiningsCte}
    SELECT DISTINCT extract(year FROM j."joiningDate")::int AS y, extract(month FROM j."joiningDate")::int AS m
    FROM j ORDER BY 1 DESC, 2 DESC
  `);
  return rows.map((r) => ymKey({ year: r.y, month: r.m }));
}

/** Everyone this AB has proposed (network link or Smart Report proposer). */
export async function memberJoinings(memberId: string, abNumber: string) {
  const items = await prisma.$queryRaw<JoiningRow[]>(Prisma.sql`
    SELECT m."joiningDate", m."abNumber", m.name, m.status::text AS status, m."kycStatus"::text AS "kycStatus",
           TRUE AS mapped, ${abNumber} AS "proposerAbNumber", NULL AS "proposerName"
    FROM "Member" m
    WHERE m."proposerId" = ${memberId}
       OR (m."proposerId" IS NULL AND m."reportProposerAbNumber" = ${abNumber})
    UNION ALL
    SELECT u."joiningDate", u."abNumber", u.name, NULL, NULL, FALSE, ${abNumber}, NULL
    FROM "UnmappedRecord" u WHERE u."proposerAbNumber" = ${abNumber}
    ORDER BY 1 DESC NULLS LAST, 2 ASC
  `);
  const byMonth = new Map<string, number>();
  for (const i of items) {
    const k = i.joiningDate ? i.joiningDate.toISOString().slice(0, 7) : 'unknown';
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }
  return {
    total: items.length,
    months: [...byMonth.entries()].map(([month, count]) => ({ month, count })),
    items: items.map((i) => ({ ...i, joiningDate: i.joiningDate ? i.joiningDate.toISOString().slice(0, 10) : null })),
  };
}
