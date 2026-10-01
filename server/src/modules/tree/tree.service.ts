import { notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { YearMonth } from '../../lib/months.js';
import { ancestors, subtreeTotalsFor } from '../network/network.repo.js';
import { LEG_ORDER, round2 } from '../pv/pv.engine.js';

export interface TreeNode {
  abNumber: string;
  name: string;
  status: string;
  kycStatus: string;
  selfPv: number;
  /** Self PV of the node + everyone below it, for the month */
  totalPv: number;
  directCount: number;
  downlineCount: number;
}

const nodeSelect = (ym: YearMonth) =>
  ({
    id: true,
    abNumber: true,
    name: true,
    status: true,
    kycStatus: true,
    createdAt: true,
    _count: { select: { children: true } },
    monthlyPv: { where: { year: ym.year, month: ym.month }, select: { selfPv: true } },
  }) as const;

type NodeRow = {
  id: string;
  abNumber: string;
  name: string;
  status: string;
  kycStatus: string;
  _count: { children: number };
  monthlyPv: { selfPv: unknown }[];
};

async function toNodes(rows: NodeRow[], ym: YearMonth): Promise<TreeNode[]> {
  const totals = await subtreeTotalsFor(
    prisma,
    rows.map((r) => r.id),
    ym,
  );
  return rows.map((r) => {
    const t = totals.get(r.id);
    return {
      abNumber: r.abNumber,
      name: r.name,
      status: r.status,
      kycStatus: r.kycStatus,
      selfPv: r.monthlyPv[0] ? Number(r.monthlyPv[0].selfPv) : 0,
      totalPv: round2(t?.pv ?? 0),
      directCount: r._count.children,
      downlineCount: Math.max(0, (t?.size ?? 1) - 1),
    };
  });
}

export async function getNode(abNumber: string, ym: YearMonth): Promise<TreeNode> {
  const row = await prisma.member.findUnique({ where: { abNumber }, select: nodeSelect(ym) });
  if (!row) throw notFound(`AB ${abNumber} does not exist`);
  return (await toNodes([row], ym))[0]!;
}

export async function getChildren(abNumber: string, ym: YearMonth): Promise<TreeNode[]> {
  const parent = await prisma.member.findUnique({ where: { abNumber }, select: { id: true } });
  if (!parent) throw notFound(`AB ${abNumber} does not exist`);
  const rows = await prisma.member.findMany({
    where: { sponsorId: parent.id },
    select: nodeSelect(ym),
    orderBy: LEG_ORDER,
  });
  return toNodes(rows, ym);
}

/** AB numbers from the Main Leader down to `abNumber` (inclusive) — used to reveal a node. */
export async function getPath(abNumber: string, rootMemberId: string) {
  const m = await prisma.member.findUnique({ where: { abNumber }, select: { id: true } });
  if (!m) throw notFound(`AB ${abNumber} does not exist`);
  const chain = await ancestors(prisma, m.id);
  const rootIdx = chain.findIndex((c) => c.id === rootMemberId);
  const path = (rootIdx >= 0 ? chain.slice(0, rootIdx + 1) : chain).reverse();
  return { inMainNetwork: rootIdx >= 0, path: path.map((p) => ({ abNumber: p.abNumber, name: p.name })) };
}
