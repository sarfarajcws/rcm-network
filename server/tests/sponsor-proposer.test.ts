/**
 * Sponsor ≠ Proposer.
 *
 *   Sponsor  -> tree position -> downline / group PV
 *   Proposer -> joining relationship -> joining analytics
 *
 * Scenario used throughout:
 *   Rahim (Main Leader)
 *   └── Rohan
 *       └── Salim      Sponsor = Rohan, Proposer = Rahim
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { addMember, type Api, resetDb, setPv, setupLeader } from './helpers.js';

const RAHIM = '1000';
const ROHAN = '1004';
const SALIM = '1006';
const M = '2026-09';

async function reportWith(rows: (string | number | Date | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['A.B. Id', 'Feeding Date', 'Name', 'Mobile', 'City', 'District', 'State', 'Proposer', 'Proposer Name',
    'PUC Home Delivery', 'Display Wall', 'September', 'Total']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const salimRow = (pv = 500) => [Number(SALIM), new Date(Date.UTC(2026, 8, 10)), 'Salim', null, null, null, null, Number(RAHIM), 'Rahim', 'Y', 'N', pv, pv];

const childrenOf = async (a: Api, ab: string) =>
  ((await a.get(`/api/tree/${ab}/children?month=${M}`)).body.data as { abNumber: string }[]).map((c) => c.abNumber);

describe('Sponsor and Proposer are independent', () => {
  let a: Api;
  beforeEach(async () => {
    await resetDb();
    a = await setupLeader(RAHIM, 'Rahim');
    await addMember(a, ROHAN, 'Rohan', RAHIM);
  });
  afterAll(async () => prisma.$disconnect());

  it('TEST 1: Salim (Sponsor Rohan, Proposer Rahim) is a child of Rohan, not of Rahim', async () => {
    await addMember(a, SALIM, 'Salim', ROHAN, { proposerAbNumber: RAHIM });
    expect(await childrenOf(a, ROHAN)).toContain(SALIM);
    expect(await childrenOf(a, RAHIM)).not.toContain(SALIM);
    const salim = await prisma.member.findUniqueOrThrow({ where: { abNumber: SALIM }, include: { sponsor: true, proposer: true } });
    expect(salim.sponsor?.abNumber).toBe(ROHAN);
    expect(salim.proposer?.abNumber).toBe(RAHIM);
  });

  it('TEST 2: an Excel row whose proposer exists becomes Unmapped with no Sponsor assigned', async () => {
    const res = await a.upload('/api/import/excel', await reportWith([salimRow()]), 'r.xlsx', { fyStartYear: '2026' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ matched: 0, unmapped: 1 });
    expect(await prisma.member.findUnique({ where: { abNumber: SALIM } })).toBeNull();
    const un = (await a.get('/api/import/unmapped')).body.data;
    expect(un).toHaveLength(1);
    expect(un[0]).toMatchObject({ abNumber: SALIM, name: 'Salim', proposerAbNumber: RAHIM, proposerInNetwork: true });
    expect(un[0]).not.toHaveProperty('sponsorAbNumber');
    expect(await childrenOf(a, RAHIM)).toEqual([ROHAN]);
  });

  it('TEST 3: placing Salim manually with Sponsor Rohan and Proposer Rahim builds Rahim > Rohan > Salim', async () => {
    await a.upload('/api/import/excel', await reportWith([salimRow()]), 'r.xlsx', { fyStartYear: '2026' });
    await addMember(a, SALIM, 'Salim', ROHAN, { proposerAbNumber: RAHIM });
    expect(await childrenOf(a, RAHIM)).toEqual([ROHAN]);
    expect(await childrenOf(a, ROHAN)).toEqual([SALIM]);
    const path = (await a.get(`/api/tree/${SALIM}/path`)).body.data.path.map((p: { abNumber: string }) => p.abNumber);
    expect(path).toEqual([RAHIM, ROHAN, SALIM]);
    // Report data and PV were attached on placement
    expect((await a.get(`/api/members/${SALIM}?month=${M}`)).body.data.pv.selfPv).toBe(500);
  });

  it('TEST 4: PV follows the Sponsor hierarchy (Salim counts inside Rohan’s leg)', async () => {
    await addMember(a, '1001', 'Karim', RAHIM, { proposerAbNumber: ROHAN });
    await addMember(a, SALIM, 'Salim', ROHAN, { proposerAbNumber: RAHIM });
    await setPv(a, RAHIM, M, 5000);
    await setPv(a, ROHAN, M, 3000);
    await setPv(a, SALIM, M, 2500);
    await setPv(a, '1001', M, 1000);

    const rahim = (await a.get(`/api/members/${RAHIM}?month=${M}`)).body.data.pv;
    expect(rahim.legs.map((l: { abNumber: string; pv: number }) => [l.abNumber, l.pv])).toEqual([
      [ROHAN, 5500], // Rohan 3000 + Salim 2500 — through Rohan's branch
      ['1001', 1000],
    ]);
    expect(rahim.legs.some((l: { abNumber: string }) => l.abNumber === SALIM)).toBe(false);
    expect(rahim.totalPv).toBe(11500);

    const rohan = (await a.get(`/api/members/${ROHAN}?month=${M}`)).body.data.pv;
    expect(rohan.totalPv).toBe(5500); // Karim (proposed by Rohan) is NOT in Rohan's PV
    expect((await a.get(`/api/members/1001?month=${M}`)).body.data.pv.totalPv).toBe(1000);
  });

  it('TEST 5: joining analytics credit Rahim for Salim while the tree keeps Salim under Rohan', async () => {
    await a.upload('/api/import/excel', await reportWith([salimRow()]), 'r.xlsx', { fyStartYear: '2026' });
    await addMember(a, SALIM, 'Salim', ROHAN, { proposerAbNumber: RAHIM });

    const rahimJoinings = (await a.get(`/api/members/${RAHIM}/joinings`)).body.data;
    expect(rahimJoinings.items.map((i: { abNumber: string }) => i.abNumber)).toContain(SALIM);
    const rohanJoinings = (await a.get(`/api/members/${ROHAN}/joinings`)).body.data;
    expect(rohanJoinings.items.map((i: { abNumber: string }) => i.abNumber)).not.toContain(SALIM);

    const month = (await a.get(`/api/joinings?month=${M}`)).body.data;
    expect(month.items.find((i: { abNumber: string }) => i.abNumber === SALIM).proposerAbNumber).toBe(RAHIM);
    expect(await childrenOf(a, ROHAN)).toContain(SALIM);
    expect(await childrenOf(a, RAHIM)).not.toContain(SALIM);
  });

  describe('TEST 6: no path converts Proposer into Sponsor', () => {
    beforeEach(async () => {
      await a.upload('/api/import/excel', await reportWith([salimRow()]), 'r.xlsx', { fyStartYear: '2026' });
    });

    it('bulk placement rejects the removed "report proposer as sponsor" mode', async () => {
      const res = await a.post('/api/import/unmapped/bulk-create', {
        abNumbers: [SALIM], sponsorMode: 'REPORT_PROPOSER', linkProposer: true, kycStatus: 'OK', status: 'ACTIVE',
      });
      expect(res.status).toBe(422);
      expect(await prisma.member.findUnique({ where: { abNumber: SALIM } })).toBeNull();
    });

    it('bulk placement without a Sponsor is rejected and leaves the AB unmapped', async () => {
      const res = await a.post('/api/import/unmapped/bulk-create', {
        abNumbers: [SALIM], linkProposer: true, kycStatus: 'OK', status: 'ACTIVE',
      });
      expect(res.status).toBe(422);
      expect((await a.get('/api/import/unmapped')).body.data).toHaveLength(1);
    });

    it('creating an AB with only a Proposer is rejected (Sponsor is mandatory)', async () => {
      const res = await a.post('/api/members', { abNumber: SALIM, name: 'Salim', proposerAbNumber: RAHIM, kycStatus: 'OK', status: 'ACTIVE' });
      expect(res.status).toBe(422);
      const sneaky = await a.post('/api/members', {
        abNumber: SALIM, name: 'Salim', sponsorAbNumber: ROHAN, proposerAbNumber: RAHIM, sponsorFromProposer: true, kycStatus: 'OK', status: 'ACTIVE',
      });
      expect(sneaky.status).toBe(422); // unknown fields are refused
    });

    it('re-importing a matched AB never changes its Sponsor', async () => {
      await addMember(a, SALIM, 'Salim', ROHAN); // no proposer link yet
      await a.upload('/api/import/excel', await reportWith([salimRow(700)]), 'r.xlsx', { fyStartYear: '2026' });
      const salim = await prisma.member.findUniqueOrThrow({ where: { abNumber: SALIM }, include: { sponsor: true, proposer: true } });
      expect(salim.sponsor?.abNumber).toBe(ROHAN); // unchanged
      expect(salim.proposer?.abNumber).toBe(RAHIM); // empty proposer link filled — proposer only
    });

    it('bulk placement links the report proposer only as Proposer', async () => {
      const res = await a.post('/api/import/unmapped/bulk-create', {
        abNumbers: [SALIM], sponsorAbNumber: ROHAN, linkProposer: true, kycStatus: 'OK', status: 'ACTIVE',
      });
      expect(res.status).toBe(201);
      const salim = await prisma.member.findUniqueOrThrow({ where: { abNumber: SALIM }, include: { sponsor: true, proposer: true } });
      expect(salim.sponsor?.abNumber).toBe(ROHAN);
      expect(salim.proposer?.abNumber).toBe(RAHIM);
    });

    it('source code contains no proposer-as-sponsor placement mode', () => {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) {
            if (f.name !== 'generated') walk(p);
          } else if (p.endsWith('.ts')) files.push(p);
        }
      };
      walk(path.resolve('src'));
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        expect(src, f).not.toMatch(/REPORT_PROPOSER|sponsorMode|sponsorFromProposer|proposerAsSponsor/);
      }
    });
  });
});
