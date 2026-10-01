/**
 * Excel import / sync.
 *
 * Safety rules enforced here:
 *  - Rows are matched to members strictly by AB Number.
 *  - Import NEVER writes Member.sponsorId (tree position). The only relationship
 *    it may touch is filling an EMPTY network Proposer link with the proposer the
 *    report names, and only when that proposer already exists as a member.
 *  - Unknown AB numbers are kept as UnmappedRecord rows, never discarded.
 *  - Re-importing overwrites the same months' PV (no additions), so the import is
 *    idempotent: the same file twice produces no changes the second time.
 *  - Work is committed in batches; each batch is one transaction.
 */
import { randomUUID } from 'node:crypto';
import { badRequest, notFound, validationError } from '../../lib/errors.js';
import { Prisma, prisma, type Tx } from '../../lib/prisma.js';
import {
  currentYearMonth,
  financialYearStart,
  type YearMonth,
  yearForFyMonth,
  ymKey,
  ymLabel,
} from '../../lib/months.js';
import { lockSponsorGraph } from '../network/network.repo.js';
import { ExcelFormatError, type ParsedRow, type ParseIssue, parseSmartReport, type ParseResult } from './excel.parser.js';

const BATCH = 200;
const MAX_STORED_ISSUES = 1000;

async function parseOrThrow(buffer: Buffer): Promise<ParseResult> {
  try {
    return await parseSmartReport(buffer);
  } catch (e) {
    if (e instanceof ExcelFormatError) throw validationError(e.message, { code: 'EXCEL_FORMAT' });
    throw e;
  }
}

/** Financial year the file most likely covers: the FY of its latest Feeding Date. */
function inferFyStartYear(parsed: ParseResult): number {
  let max: Date | null = null;
  for (const r of parsed.rows) if (r.joiningDate && (!max || r.joiningDate > max)) max = r.joiningDate;
  const current = financialYearStart(currentYearMonth());
  if (!max) return current;
  const fy = financialYearStart({ year: max.getUTCFullYear(), month: max.getUTCMonth() + 1 });
  return Math.min(fy, current);
}

function monthsFor(parsed: ParseResult, fyStartYear: number) {
  const cur = currentYearMonth();
  return parsed.monthColumns.map((mc) => {
    const ym: YearMonth = { year: yearForFyMonth(fyStartYear, mc.month), month: mc.month };
    const future = ym.year > cur.year || (ym.year === cur.year && ym.month > cur.month);
    return { ...mc, ym, key: ymKey(ym), future };
  });
}

// ---------------------------------------------------------------------------
// Preview (no writes)
// ---------------------------------------------------------------------------

export async function previewImport(buffer: Buffer, fileName: string, fyStartYear?: number) {
  const parsed = await parseOrThrow(buffer);
  const fy = fyStartYear ?? inferFyStartYear(parsed);
  const months = monthsFor(parsed, fy);
  const abs = parsed.rows.map((r) => r.abNumber);
  const matched = abs.length
    ? await prisma.member.count({ where: { abNumber: { in: abs } } })
    : 0;
  return {
    fileName,
    sheetName: parsed.sheetName,
    headerRow: parsed.headerRow,
    columns: parsed.columns,
    fyStartYear: fy,
    suggestedFyStartYear: inferFyStartYear(parsed),
    months: months.map((m) => ({ header: m.header, month: m.key, label: ymLabel(m.ym), future: m.future })),
    totalRows: parsed.totalRows,
    validRows: parsed.rows.length,
    matched,
    unmapped: parsed.rows.length - matched,
    invalid: parsed.invalidRows,
    duplicates: parsed.duplicateRows,
    issues: parsed.issues.slice(0, 200),
    issueCount: parsed.issues.length,
    sample: parsed.rows.slice(0, 5).map((r) => ({
      abNumber: r.abNumber,
      name: r.name,
      joiningDate: r.joiningDate?.toISOString().slice(0, 10) ?? null,
      proposerAbNumber: r.proposerAbNumber,
      proposerName: r.proposerName,
    })),
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

type ExistingMember = {
  id: string;
  abNumber: string;
  name: string;
  proposerId: string | null;
  joiningDate: Date | null;
  mobile: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  reportProposerAbNumber: string | null;
  reportProposerName: string | null;
  pucHomeDelivery: boolean | null;
  displayWall: boolean | null;
};

const sameDate = (a: Date | null, b: Date | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());

function reportDiff(m: ExistingMember, r: ParsedRow): Prisma.MemberUncheckedUpdateInput | null {
  const d: Prisma.MemberUncheckedUpdateInput = {};
  if (m.name !== r.name) d.name = r.name;
  // A blank report cell never wipes an existing value.
  if (r.joiningDate && !sameDate(m.joiningDate, r.joiningDate)) d.joiningDate = r.joiningDate;
  const textFields = [
    ['mobile', 'mobile'],
    ['city', 'city'],
    ['district', 'district'],
    ['state', 'state'],
    ['reportProposerAbNumber', 'proposerAbNumber'],
    ['reportProposerName', 'proposerName'],
  ] as const;
  for (const [mk, rk] of textFields) {
    const v = r[rk];
    if (v !== null && m[mk] !== v) d[mk] = v;
  }
  if (r.pucHomeDelivery !== null && m.pucHomeDelivery !== r.pucHomeDelivery) d.pucHomeDelivery = r.pucHomeDelivery;
  if (r.displayWall !== null && m.displayWall !== r.displayWall) d.displayWall = r.displayWall;
  return Object.keys(d).length ? d : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runImport(opts: { buffer: Buffer; fileName: string; fileSize: number; fyStartYear?: number; rootMemberId: string }) {
  const currentFy = financialYearStart(currentYearMonth());
  if (opts.fyStartYear !== undefined && (opts.fyStartYear < 2000 || opts.fyStartYear > currentFy)) {
    throw validationError(`Financial year must be between 2000-01 and ${currentFy}-${String((currentFy + 1) % 100).padStart(2, '0')}`);
  }

  const batch = await prisma.importBatch.create({
    data: { fileName: opts.fileName.slice(0, 255), fileSize: opts.fileSize, fyStartYear: opts.fyStartYear ?? currentFy },
  });

  try {
    const parsed = await parseOrThrow(opts.buffer);
    const fy = opts.fyStartYear ?? inferFyStartYear(parsed);
    const allMonths = monthsFor(parsed, fy);
    const issues: ParseIssue[] = [...parsed.issues];
    for (const m of allMonths.filter((x) => x.future)) {
      issues.push({ row: parsed.headerRow, severity: 'warning', message: `${m.header} maps to ${ymLabel(m.ym)}, which is in the future — column skipped. Check the financial year.` });
    }
    const months = allMonths.filter((m) => !m.future);

    const counts = {
      matched: 0,
      updated: 0,
      unchanged: 0,
      pvChanged: 0,
      proposerLinked: 0,
      unmapped: 0,
      newUnmapped: 0,
    };

    // ---- Lookups (bulk, no N+1) ----
    const abs = parsed.rows.map((r) => r.abNumber);
    const members = new Map<string, ExistingMember>();
    for (const part of chunk(abs, 5000)) {
      const found = await prisma.member.findMany({
        where: { abNumber: { in: part } },
        select: {
          id: true, abNumber: true, name: true, proposerId: true, joiningDate: true, mobile: true, city: true,
          district: true, state: true, reportProposerAbNumber: true, reportProposerName: true,
          pucHomeDelivery: true, displayWall: true,
        },
      });
      for (const m of found) members.set(m.abNumber, m);
    }
    const proposerAbs = [...new Set(parsed.rows.map((r) => r.proposerAbNumber).filter((x): x is string => !!x))];
    const proposerIds = new Map<string, string>();
    for (const part of chunk(proposerAbs, 5000)) {
      const found = await prisma.member.findMany({ where: { abNumber: { in: part } }, select: { id: true, abNumber: true } });
      for (const m of found) proposerIds.set(m.abNumber, m.id);
    }
    const existingPv = new Map<string, number>();
    if (members.size && months.length) {
      const ids = [...members.values()].map((m) => m.id);
      for (const part of chunk(ids, 5000)) {
        const rows = await prisma.monthlyPv.findMany({
          where: { memberId: { in: part }, OR: months.map((m) => ({ year: m.ym.year, month: m.ym.month })) },
          select: { memberId: true, year: true, month: true, selfPv: true },
        });
        for (const r of rows) existingPv.set(`${r.memberId}|${r.year}|${r.month}`, Number(r.selfPv));
      }
    }

    const matchedRows = parsed.rows.filter((r) => members.has(r.abNumber));
    const unmappedRows = parsed.rows.filter((r) => !members.has(r.abNumber));
    counts.matched = matchedRows.length;

    // ---- Matched members: report fields + monthly PV ----
    const now = new Date();
    for (const part of chunk(matchedRows, BATCH)) {
      await prisma.$transaction(
        async (tx) => {
          const pvUpserts: { id: string; memberId: string; year: number; month: number; pv: number }[] = [];
          const audits: Prisma.PvAuditLogCreateManyInput[] = [];
          const touched: string[] = [];

          for (const r of part) {
            const m = members.get(r.abNumber)!;
            let changed = false;
            const diff = reportDiff(m, r) ?? {};
            // Fill an EMPTY network Proposer link from the report (never overwrite one).
            if (
              m.proposerId === null &&
              m.id !== opts.rootMemberId &&
              r.proposerAbNumber &&
              r.proposerAbNumber !== r.abNumber
            ) {
              const pid = proposerIds.get(r.proposerAbNumber);
              if (pid) {
                diff.proposerId = pid;
                counts.proposerLinked++;
              }
            }
            if (Object.keys(diff).length) {
              changed = true;
              await tx.member.update({
                where: { id: m.id },
                data: { ...diff, reportUpdatedAt: now, lastImportId: batch.id },
              });
            } else touched.push(m.id);

            for (const mc of months) {
              const v = r.pv.get(mc.month);
              if (v === undefined) continue;
              const key = `${m.id}|${mc.ym.year}|${mc.ym.month}`;
              const old = existingPv.get(key);
              if (old !== undefined && Math.abs(old - v) < 0.005) continue;
              pvUpserts.push({ id: randomUUID(), memberId: m.id, year: mc.ym.year, month: mc.ym.month, pv: v });
              audits.push({
                memberId: m.id, year: mc.ym.year, month: mc.ym.month, oldPv: old ?? null, newPv: v,
                source: 'EXCEL', importId: batch.id,
              });
              changed = true;
            }
            if (changed) counts.updated++;
            else counts.unchanged++;
          }

          if (pvUpserts.length) {
            const values = pvUpserts.map(
              (u) => Prisma.sql`(${u.id}, ${u.memberId}, ${u.year}, ${u.month}, ${u.pv}::numeric(14,2), 'EXCEL'::"PvSource", ${batch.id}, now(), now())`,
            );
            await tx.$executeRaw`
              INSERT INTO "MonthlyPv" ("id","memberId","year","month","selfPv","source","importId","createdAt","updatedAt")
              VALUES ${Prisma.join(values)}
              ON CONFLICT ("memberId","year","month") DO UPDATE
                SET "selfPv" = EXCLUDED."selfPv", "source" = 'EXCEL', "importId" = EXCLUDED."importId", "updatedAt" = now()`;
            await tx.pvAuditLog.createMany({ data: audits });
            counts.pvChanged += pvUpserts.length;
          }
          if (touched.length) {
            await tx.member.updateMany({
              where: { id: { in: touched } },
              data: { reportUpdatedAt: now, lastImportId: batch.id },
            });
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    }

    // ---- Unmapped rows: keep them for the user to place in the tree ----
    counts.unmapped = unmappedRows.length;
    if (unmappedRows.length) {
      const existingUnmapped = new Set<string>();
      for (const part of chunk(unmappedRows.map((r) => r.abNumber), 5000)) {
        const found = await prisma.unmappedRecord.findMany({ where: { abNumber: { in: part } }, select: { abNumber: true } });
        found.forEach((f) => existingUnmapped.add(f.abNumber));
      }
      counts.newUnmapped = unmappedRows.filter((r) => !existingUnmapped.has(r.abNumber)).length;

      for (const part of chunk(unmappedRows, BATCH)) {
        const values = part.map((r) => {
          const pv: Record<string, number> = {};
          for (const mc of months) {
            const v = r.pv.get(mc.month);
            if (v !== undefined) pv[mc.key] = v;
          }
          return Prisma.sql`(${randomUUID()}, ${r.abNumber}, ${r.name}, ${r.joiningDate}::date, ${r.mobile}, ${r.city},
            ${r.district}, ${r.state}, ${r.proposerAbNumber}, ${r.proposerName}, ${r.pucHomeDelivery}, ${r.displayWall},
            ${JSON.stringify(pv)}::jsonb, ${batch.id}, ${batch.id}, now(), now(), now())`;
        });
        await prisma.$executeRaw`
          INSERT INTO "UnmappedRecord" ("id","abNumber","name","joiningDate","mobile","city","district","state",
            "proposerAbNumber","proposerName","pucHomeDelivery","displayWall","monthlyPv","firstImportId","lastImportId",
            "lastSeenAt","createdAt","updatedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("abNumber") DO UPDATE SET
            "name" = EXCLUDED."name",
            "joiningDate" = COALESCE(EXCLUDED."joiningDate", "UnmappedRecord"."joiningDate"),
            "mobile" = COALESCE(EXCLUDED."mobile", "UnmappedRecord"."mobile"),
            "city" = COALESCE(EXCLUDED."city", "UnmappedRecord"."city"),
            "district" = COALESCE(EXCLUDED."district", "UnmappedRecord"."district"),
            "state" = COALESCE(EXCLUDED."state", "UnmappedRecord"."state"),
            "proposerAbNumber" = COALESCE(EXCLUDED."proposerAbNumber", "UnmappedRecord"."proposerAbNumber"),
            "proposerName" = COALESCE(EXCLUDED."proposerName", "UnmappedRecord"."proposerName"),
            "pucHomeDelivery" = COALESCE(EXCLUDED."pucHomeDelivery", "UnmappedRecord"."pucHomeDelivery"),
            "displayWall" = COALESCE(EXCLUDED."displayWall", "UnmappedRecord"."displayWall"),
            "monthlyPv" = "UnmappedRecord"."monthlyPv" || EXCLUDED."monthlyPv",
            "lastImportId" = EXCLUDED."lastImportId",
            "lastSeenAt" = now(),
            "updatedAt" = now()`;
      }
    }

    // Safety net: an AB that is now a member must not linger as unmapped.
    await prisma.$executeRaw`DELETE FROM "UnmappedRecord" u USING "Member" m WHERE m."abNumber" = u."abNumber"`;

    const finished = await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'COMPLETED',
        fyStartYear: fy,
        sheetName: parsed.sheetName,
        months: months.map((m) => m.key),
        totalRows: parsed.totalRows,
        matchedCount: counts.matched,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        pvValuesChanged: counts.pvChanged,
        proposerLinked: counts.proposerLinked,
        unmappedCount: counts.unmapped,
        newUnmappedCount: counts.newUnmapped,
        duplicateCount: parsed.duplicateRows,
        invalidCount: parsed.invalidRows,
        issues: issues.slice(0, MAX_STORED_ISSUES) as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return batchDto(finished, issues.length);
  } catch (e) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'FAILED',
        errorMessage: e instanceof Error ? e.message.slice(0, 1000) : 'Unknown error',
        finishedAt: new Date(),
      },
    });
    throw e;
  }
}

type BatchRow = Awaited<ReturnType<typeof prisma.importBatch.findUniqueOrThrow>>;

function batchDto(b: BatchRow, issueCount?: number) {
  const issues = (b.issues ?? []) as unknown as ParseIssue[];
  return {
    id: b.id,
    fileName: b.fileName,
    fileSize: b.fileSize,
    sheetName: b.sheetName,
    fyStartYear: b.fyStartYear,
    months: b.months as string[],
    status: b.status,
    totalRows: b.totalRows,
    matched: b.matchedCount,
    updated: b.updatedCount,
    unchanged: b.unchangedCount,
    pvValuesChanged: b.pvValuesChanged,
    proposerLinked: b.proposerLinked,
    unmapped: b.unmappedCount,
    newUnmapped: b.newUnmappedCount,
    duplicates: b.duplicateCount,
    invalid: b.invalidCount,
    errorMessage: b.errorMessage,
    issueCount: issueCount ?? issues.length,
    issues,
    startedAt: b.startedAt,
    finishedAt: b.finishedAt,
  };
}

export async function importHistory(limit = 50) {
  const rows = await prisma.importBatch.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
  return rows.map((b) => {
    const { issues: _i, ...rest } = batchDto(b);
    return rest;
  });
}

export async function importDetail(id: string) {
  const b = await prisma.importBatch.findUnique({ where: { id } });
  if (!b) throw notFound('Import not found');
  return batchDto(b);
}

// ---------------------------------------------------------------------------
// Unmapped records
// ---------------------------------------------------------------------------

export async function listUnmapped(q?: string) {
  const term = q?.trim();
  const where: Prisma.UnmappedRecordWhereInput = term
    ? /^\d+$/.test(term)
      ? { OR: [{ abNumber: { startsWith: term } }, { proposerAbNumber: { startsWith: term } }] }
      : { OR: [{ name: { contains: term, mode: 'insensitive' } }, { proposerName: { contains: term, mode: 'insensitive' } }] }
    : {};
  const rows = await prisma.unmappedRecord.findMany({
    where,
    orderBy: [{ joiningDate: 'asc' }, { abNumber: 'asc' }],
    take: 5000,
  });
  const proposerAbs = [...new Set(rows.map((r) => r.proposerAbNumber).filter((x): x is string => !!x))];
  const inNetwork = new Map(
    (await prisma.member.findMany({ where: { abNumber: { in: proposerAbs } }, select: { abNumber: true, name: true } })).map(
      (m) => [m.abNumber, m.name],
    ),
  );
  const pendingAbs = new Set(rows.map((r) => r.abNumber));
  return rows.map((r) => {
    const pv = (r.monthlyPv ?? {}) as Record<string, number>;
    const latestKey = Object.keys(pv).sort().pop();
    return {
      abNumber: r.abNumber,
      name: r.name,
      joiningDate: r.joiningDate?.toISOString().slice(0, 10) ?? null,
      mobile: r.mobile,
      city: r.city,
      district: r.district,
      state: r.state,
      proposerAbNumber: r.proposerAbNumber,
      proposerName: r.proposerName,
      proposerInNetwork: r.proposerAbNumber ? inNetwork.has(r.proposerAbNumber) : false,
      proposerPending: r.proposerAbNumber ? pendingAbs.has(r.proposerAbNumber) : false,
      monthlyPv: pv,
      latestPv: latestKey ? { month: latestKey, pv: pv[latestKey] } : null,
      lastSeenAt: r.lastSeenAt,
      firstImportId: r.firstImportId,
    };
  });
}

export async function dismissUnmapped(abNumber: string) {
  const r = await prisma.unmappedRecord.deleteMany({ where: { abNumber } });
  if (r.count === 0) throw notFound(`AB ${abNumber} is not in the unmapped list`);
  return { dismissed: abNumber };
}

export interface BulkCreateInput {
  abNumbers: string[];
  /** Explicitly chosen by the user. Required — Sponsor is never inferred. */
  sponsorAbNumber: string;
  /** Link the Proposer named in the Smart Report (Proposer only, never Sponsor). */
  linkProposer: boolean;
  kycStatus: 'OK' | 'NOT_OK';
  status: 'ACTIVE' | 'TERMINATED';
}

/**
 * Explicit, user-initiated placement of selected unmapped ABs under ONE Sponsor
 * that the user chose. The Smart Report has no Sponsor information, so the
 * Sponsor is never derived from the report's Proposer (Sponsor ≠ Proposer).
 * The report's Proposer may optionally be linked as the network Proposer.
 */
export async function bulkCreateFromUnmapped(input: BulkCreateInput) {
  if (!input.sponsorAbNumber) throw validationError('Select a Sponsor before placing ABs in the network.');
  const unique = [...new Set(input.abNumbers)];
  if (unique.length === 0) throw badRequest('Select at least one AB');
  if (unique.includes(input.sponsorAbNumber)) throw validationError('An AB cannot be its own Sponsor');

  return prisma.$transaction(
    async (tx: Tx) => {
      await lockSponsorGraph(tx);
      const sponsor = await tx.member.findUnique({ where: { abNumber: input.sponsorAbNumber }, select: { id: true } });
      if (!sponsor) throw validationError(`Sponsor AB ${input.sponsorAbNumber} does not exist in the network`);

      const recs = await tx.unmappedRecord.findMany({ where: { abNumber: { in: unique } } });
      const skipped: { abNumber: string; reason: string }[] = unique
        .filter((ab) => !recs.some((r) => r.abNumber === ab))
        .map((ab) => ({ abNumber: ab, reason: 'Not in the unmapped list (already created or dismissed)' }));

      const created: { abNumber: string; name: string; sponsorAbNumber: string }[] = [];
      if (recs.length) {
        const rows = await tx.member.createManyAndReturn({
          data: recs.map((r) => ({
            abNumber: r.abNumber,
            name: r.name,
            kycStatus: input.kycStatus,
            status: input.status,
            sponsorId: sponsor.id, // always the user's explicit choice
            proposerId: null, // linked below, separately
            joiningDate: r.joiningDate,
            mobile: r.mobile,
            city: r.city,
            district: r.district,
            state: r.state,
            reportProposerAbNumber: r.proposerAbNumber,
            reportProposerName: r.proposerName,
            pucHomeDelivery: r.pucHomeDelivery,
            displayWall: r.displayWall,
            reportUpdatedAt: r.lastSeenAt,
            lastImportId: r.lastImportId,
          })),
          select: { id: true, abNumber: true, name: true },
        });

        const pvData: Prisma.MonthlyPvCreateManyInput[] = [];
        const auditData: Prisma.PvAuditLogCreateManyInput[] = [];
        for (const m of rows) {
          const rec = recs.find((r) => r.abNumber === m.abNumber)!;
          created.push({ abNumber: m.abNumber, name: m.name, sponsorAbNumber: input.sponsorAbNumber });
          for (const [k, v] of Object.entries((rec.monthlyPv ?? {}) as Record<string, number>)) {
            const [y, mo] = k.split('-').map(Number);
            if (!y || !mo || !Number.isFinite(Number(v)) || Number(v) < 0) continue;
            pvData.push({ memberId: m.id, year: y, month: mo, selfPv: Number(v), source: 'EXCEL', importId: rec.lastImportId });
            auditData.push({ memberId: m.id, year: y, month: mo, oldPv: null, newPv: Number(v), source: 'EXCEL', importId: rec.lastImportId });
          }
        }
        if (pvData.length) {
          await tx.monthlyPv.createMany({ data: pvData, skipDuplicates: true });
          await tx.pvAuditLog.createMany({ data: auditData });
        }
        await tx.unmappedRecord.deleteMany({ where: { abNumber: { in: recs.map((r) => r.abNumber) } } });

        // Proposer link (joining relationship only). Resolved after creation so a
        // proposer placed in this same batch is found. Never touches sponsorId.
        if (input.linkProposer) {
          const proposerAbs = [...new Set(recs.map((r) => r.proposerAbNumber).filter((x): x is string => !!x))];
          const proposerIds = new Map(
            (await tx.member.findMany({ where: { abNumber: { in: proposerAbs } }, select: { id: true, abNumber: true } })).map(
              (m) => [m.abNumber, m.id],
            ),
          );
          for (const m of rows) {
            const rec = recs.find((r) => r.abNumber === m.abNumber)!;
            const pid = rec.proposerAbNumber && rec.proposerAbNumber !== rec.abNumber ? proposerIds.get(rec.proposerAbNumber) : undefined;
            if (pid) await tx.member.update({ where: { id: m.id }, data: { proposerId: pid } });
          }
        }
      }
      return { created: created.length, createdItems: created, skipped };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
