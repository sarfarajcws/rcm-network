import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { addMember, type Api, resetDb, ROOT_AB, setPv, setupLeader } from './helpers.js';

const REAL = fs.readFileSync(path.resolve('tests/fixtures/smart_report.xlsx'));
const HEADERS = ['A.B. Id', 'Feeding Date', 'Name', 'Mobile', 'City', 'District', 'State', 'Proposer', 'Proposer Name',
  'PUC Home Delivery', 'Display Wall', 'April', 'May', 'June', 'July', 'August', 'September', 'Total'];

type Row = (string | number | Date | null)[];
async function workbook(rows: Row[], headers = HEADERS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const row = (ab: number | string, name: string, proposer: number, pv: number[], date = new Date(Date.UTC(2026, 8, 3))): Row => [
  ab, date, name, 9000000000, 'UDHWA', 'Sahibganj', 'Jharkhand', proposer, 'PROP', 'Y', 'N', ...pv, pv.reduce((s, x) => s + x, 0),
];

describe('Excel import (Smart Report)', () => {
  let a: Api;
  beforeEach(async () => {
    await resetDb();
    a = await setupLeader();
  });
  afterAll(async () => prisma.$disconnect());

  it('reads the real Smart Report structure', async () => {
    const res = await a.upload('/api/import/excel/preview', REAL, 'Report_smart_report.xlsx');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.sheetName).toBe('Sheet1');
    expect(d.columns.abNumber).toBe('A.B. Id');
    expect(d.columns.joiningDate).toBe('Feeding Date');
    expect(d.months.map((m: { month: string }) => m.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(d.totalRows).toBe(711);
    expect(d.unmapped).toBe(711);
    expect(d.invalid).toBe(0);
    expect(d.duplicates).toBe(0);
  });

  it('keeps unknown ABs as unmapped and attaches data once the AB is created', async () => {
    const imp = await a.upload('/api/import/excel', REAL);
    expect(imp.status).toBe(201);
    expect(imp.body.data).toMatchObject({ totalRows: 711, matched: 0, unmapped: 711, newUnmapped: 711 });

    const unmapped = (await a.get('/api/import/unmapped')).body.data;
    expect(unmapped).toHaveLength(711);
    const k = unmapped.find((u: { abNumber: string }) => u.abNumber === '30594292');
    expect(k).toMatchObject({ name: 'KUTUBUDDIN SHEKH', joiningDate: '2015-01-01', proposerAbNumber: '662873' });
    expect(k.monthlyPv['2026-09']).toBe(1201);

    // Create the node manually -> report data + PV history move onto the member
    const created = await addMember(a, '30594292', 'KUTUBUDDIN SHEKH', ROOT_AB);
    expect(created.report.mobile).toBe('9534109093');
    expect(created.report.joiningDate).toBe('2015-01-01');
    const pv = (await a.get('/api/members/30594292?month=2026-04')).body.data.pv;
    expect(pv.selfPv).toBe(2201);
    expect((await a.get('/api/import/unmapped')).body.data).toHaveLength(710);

    // The next import recognises it automatically
    const again = await a.upload('/api/import/excel', REAL);
    expect(again.body.data).toMatchObject({ matched: 1, unmapped: 710, newUnmapped: 0, updated: 0 });
  });

  it('matches strictly by AB Number, never by name', async () => {
    await addMember(a, '5001', 'Same Name', ROOT_AB);
    const buf = await workbook([row(5002, 'Same Name', 5001, [1, 2, 3, 4, 5, 6])]);
    const res = await a.upload('/api/import/excel', buf);
    expect(res.body.data).toMatchObject({ matched: 0, unmapped: 1 });
    expect((await a.get('/api/pv/lookup?abNumber=5001&month=2026-09')).body.data.currentPv).toBe(0);
  });

  it('re-upload overwrites the month PV and never touches the sponsor tree', async () => {
    await addMember(a, '1001', 'Rohan', ROOT_AB);
    await addMember(a, '1002', 'Mohan', '1001', { proposerAbNumber: ROOT_AB });

    const mid = await workbook([row(1001, 'Rohan', 9736085, [0, 0, 0, 0, 0, 1200]), row(1002, 'Mohan', 1001, [0, 0, 0, 0, 0, 300])]);
    const r1 = await a.upload('/api/import/excel', mid);
    expect(r1.body.data).toMatchObject({ matched: 2, updated: 2 });
    expect((await a.get('/api/pv/lookup?abNumber=1001&month=2026-09')).body.data.currentPv).toBe(1200);

    const end = await workbook([row(1001, 'Rohan', 9736085, [0, 0, 0, 0, 0, 1850]), row(1002, 'Mohan', 1001, [0, 0, 0, 0, 0, 300])]);
    const r2 = await a.upload('/api/import/excel', end);
    expect(r2.body.data).toMatchObject({ matched: 2, updated: 1, unchanged: 1, pvValuesChanged: 1 });
    expect((await a.get('/api/pv/lookup?abNumber=1001&month=2026-09')).body.data.currentPv).toBe(1850);

    const mohan = (await a.get('/api/members/1002')).body.data.member;
    expect(mohan.sponsor.abNumber).toBe('1001');
    expect(mohan.proposer.abNumber).toBe(ROOT_AB); // existing proposer link not overwritten by report (1001)
    expect(mohan.report.proposerAbNumber).toBe('1001');

    // Same file again -> idempotent
    const r3 = await a.upload('/api/import/excel', end);
    expect(r3.body.data).toMatchObject({ updated: 0, unchanged: 2, pvValuesChanged: 0 });

    // Group PV reflects the import
    expect((await a.get('/api/members/1001?month=2026-09')).body.data.pv.totalPv).toBe(2150);
  });

  it('manual updates and imports write the same monthly PV', async () => {
    await addMember(a, '1001', 'Rohan', ROOT_AB);
    await setPv(a, '1001', '2026-09', 999);
    await a.upload('/api/import/excel', await workbook([row(1001, 'Rohan', 1, [0, 0, 0, 0, 0, 500])]));
    const look = (await a.get('/api/pv/lookup?abNumber=1001&month=2026-09')).body.data;
    expect(look.currentPv).toBe(500);
    expect(look.source).toBe('EXCEL');
    const audit = (await a.get('/api/members/1001/pv-audit')).body.data;
    expect(audit.map((x: { source: string }) => x.source)).toContain('MANUAL');
  });

  it('fills an empty proposer link from the report when the proposer exists', async () => {
    await addMember(a, '1001', 'Rohan', ROOT_AB);
    await addMember(a, '1002', 'Mohan', ROOT_AB);
    const res = await a.upload('/api/import/excel', await workbook([row(1002, 'Mohan', 1001, [0, 0, 0, 0, 0, 1])]));
    expect(res.body.data.proposerLinked).toBe(1);
    const m = (await a.get('/api/members/1002')).body.data.member;
    expect(m.proposer.abNumber).toBe('1001');
    expect(m.sponsor.abNumber).toBe(ROOT_AB);
  });

  it('reports duplicates, invalid rows and total mismatches', async () => {
    const buf = await workbook([
      row(7001, 'A', 1, [1, 1, 1, 1, 1, 1]),
      row(7001, 'A again', 1, [2, 2, 2, 2, 2, 2]),
      row('ABC', 'Bad', 1, [0, 0, 0, 0, 0, 0]),
      [7002, null, null, null, null, null, null, null, null, null, null, 1, 1, 1, 1, 1, 1, 6],
      [7003, '01-08-2026', 'Text date', null, null, null, null, 1, 'P', 'Y', 'N', 1, 1, 1, 1, 1, '-5', 999],
    ]);
    const res = await a.upload('/api/import/excel', buf);
    const d = res.body.data;
    expect(d.totalRows).toBe(5);
    expect(d.duplicates).toBe(1);
    expect(d.invalid).toBe(2); // bad AB + missing name
    expect(d.unmapped).toBe(2);
    const msgs = d.issues.map((i: { message: string }) => i.message).join('\n');
    expect(msgs).toMatch(/Duplicate AB Number/);
    expect(msgs).toMatch(/Invalid or missing AB Number/);
    expect(msgs).toMatch(/September PV "-5"/);
    expect(msgs).toMatch(/Total \(999\)/);
    const u = (await a.get('/api/import/unmapped')).body.data.find((x: { abNumber: string }) => x.abNumber === '7003');
    expect(u.joiningDate).toBe('2026-08-01'); // dd-mm-yyyy text parsed as Indian format
    expect(u.monthlyPv['2026-09']).toBeUndefined();
    const first = (await a.get('/api/import/unmapped')).body.data.find((x: { abNumber: string }) => x.abNumber === '7001');
    expect(first.name).toBe('A');
  });

  it('rejects non-Excel files and workbooks without the expected header', async () => {
    const txt = await a.upload('/api/import/excel', Buffer.from('hello'), 'notes.txt');
    expect(txt.status).toBe(400);
    const fake = await a.upload('/api/import/excel', Buffer.from('not a zip at all'), 'fake.xlsx');
    expect(fake.status).toBe(422);
    const noHeader = await a.upload('/api/import/excel', await workbook([[1, 2, 3]], ['Foo', 'Bar', 'Baz']));
    expect(noHeader.status).toBe(422);
    const hist = (await a.get('/api/import/history')).body.data;
    expect(hist[0].status).toBe('FAILED');
  });

  it('skips month columns that would be in the future', async () => {
    const res = await a.upload('/api/import/excel', await workbook([row(8001, 'F', 1, [1, 1, 1, 1, 1, 1])]), 'r.xlsx', {
      fyStartYear: '2026',
    });
    expect(res.status).toBe(201);
    const wb = await workbook(
      [[8002, new Date(), 'G', null, null, null, null, 1, 'P', 'Y', 'N', 5, 5]],
      ['A.B. Id', 'Feeding Date', 'Name', 'Mobile', 'City', 'District', 'State', 'Proposer', 'Proposer Name', 'PUC Home Delivery', 'Display Wall', 'September', 'March'],
    );
    const r2 = await a.upload('/api/import/excel', wb, 'r.xlsx', { fyStartYear: '2026' });
    expect(r2.body.data.months).toEqual(['2026-09']); // March 2027 skipped
    expect(r2.body.data.issues.some((i: { message: string }) => /future/.test(i.message))).toBe(true);
  });

  it('bulk placement requires an explicit Sponsor; the report proposer is linked only as Proposer', async () => {
    await addMember(a, '9001', 'Proposer AB', ROOT_AB);
    await addMember(a, '9005', 'Chosen Sponsor', ROOT_AB);
    await a.upload('/api/import/excel', await workbook([row(9002, 'New AB', 9001, [0, 0, 0, 0, 0, 10])]));

    const noSponsor = await a.post('/api/import/unmapped/bulk-create', {
      abNumbers: ['9002'], linkProposer: true, kycStatus: 'OK', status: 'ACTIVE',
    });
    expect(noSponsor.status).toBe(422);

    const ok = await a.post('/api/import/unmapped/bulk-create', {
      abNumbers: ['9002'], sponsorAbNumber: '9005', linkProposer: true, kycStatus: 'OK', status: 'ACTIVE',
    });
    expect(ok.status).toBe(201);
    const m = (await a.get('/api/members/9002?month=2026-09')).body.data;
    expect(m.member.sponsor.abNumber).toBe('9005');
    expect(m.member.proposer.abNumber).toBe('9001');
    expect(m.pv.selfPv).toBe(10);
  });

  it('places the full real report under an explicitly chosen Sponsor and totals network PV correctly', async () => {
    await a.upload('/api/import/excel', REAL);
    const un = (await a.get('/api/import/unmapped')).body.data as { abNumber: string }[];
    const res = await a.post('/api/import/unmapped/bulk-create', {
      abNumbers: un.map((u) => u.abNumber), sponsorAbNumber: ROOT_AB, linkProposer: true, kycStatus: 'OK', status: 'ACTIVE',
    });
    expect(res.body.data.created).toBe(711);
    expect(res.body.data.skipped).toEqual([]);
    expect((await a.get('/api/import/unmapped')).body.data).toHaveLength(0);
    // Every AB sits exactly where the user put it, regardless of its proposer
    expect(await prisma.member.count({ where: { sponsor: { abNumber: ROOT_AB } } })).toBe(711);

    // Expected September total straight from the spreadsheet
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(REAL as unknown as ExcelJS.Buffer);
    let sep = 0;
    wb.worksheets[0]!.eachRow((r, i) => {
      if (i > 1) sep += Number(r.getCell(17).value);
    });
    const root = (await a.get(`/api/members/${ROOT_AB}?month=2026-09`)).body.data;
    expect(root.summary.totalDownline).toBe(711);
    expect(root.pv.totalPv).toBeCloseTo(sep, 2);
  });
});

describe('Joining analytics', () => {
  let a: Api;
  beforeEach(async () => {
    await resetDb();
    a = await setupLeader();
  });

  it('builds proposer-wise and month-wise joinings from Feeding Date', async () => {
    await addMember(a, '100', 'Rohan', ROOT_AB);
    const buf = await workbook([
      row(100, 'Rohan', 9736085, [0, 0, 0, 0, 0, 0], new Date(Date.UTC(2026, 7, 1))),
      row(201, 'XYZ', 100, [0, 0, 0, 0, 0, 0], new Date(Date.UTC(2026, 9 - 1, 1))),
      row(202, 'ABC', 100, [0, 0, 0, 0, 0, 0], new Date(Date.UTC(2026, 9 - 1, 3))),
      row(203, 'PQR', 100, [0, 0, 0, 0, 0, 0], new Date(Date.UTC(2026, 8 - 1, 20))),
    ]);
    await a.upload('/api/import/excel', buf);
    await addMember(a, '201', 'XYZ', '100'); // proposer link auto-from-report? no: set explicitly below
    await a.patch('/api/members/201', { proposerAbNumber: '100' });

    const sep = (await a.get('/api/joinings?month=2026-09')).body.data;
    expect(sep.total).toBe(2);
    expect(sep.items.map((i: { abNumber: string }) => i.abNumber).sort()).toEqual(['201', '202']);
    expect(sep.byProposer[0]).toMatchObject({ proposerAbNumber: '100', count: 2 });
    expect(sep.unmappedCount).toBe(1);

    const mappedOnly = (await a.get('/api/joinings?month=2026-09&includeUnmapped=false')).body.data;
    expect(mappedOnly.total).toBe(1);

    const prof = (await a.get('/api/members/100/joinings')).body.data;
    expect(prof.total).toBe(3);
    expect(prof.months).toEqual([
      { month: '2026-09', count: 2 },
      { month: '2026-08', count: 1 },
    ]);
    expect((await a.get('/api/members/100')).body.data.joinings.total).toBe(3);

    const ranged = (await a.get('/api/joinings?from=2026-08-01&to=2026-09-01')).body.data;
    expect(ranged.total).toBe(3); // 100 (Aug 1), 203 (Aug 20), 201 (Sep 1)
  });
});
