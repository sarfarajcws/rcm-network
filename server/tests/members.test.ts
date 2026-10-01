import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { addMember, type Api, resetDb, ROOT_AB, setPv, setupLeader } from './helpers.js';

describe('Members, sponsor tree and statistics', () => {
  let a: Api;
  beforeEach(async () => {
    await resetDb();
    a = await setupLeader();
  });
  afterAll(async () => prisma.$disconnect());

  it('creates an AB and prevents duplicates', async () => {
    await addMember(a, '100', 'Rohan', ROOT_AB);
    const dup = await a.post('/api/members', {
      abNumber: '100', name: 'Other', sponsorAbNumber: ROOT_AB, kycStatus: 'OK', status: 'ACTIVE',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_AB');
    expect(await prisma.member.count({ where: { abNumber: '100' } })).toBe(1);
  });

  it('handles concurrent creation of the same AB without duplicates', async () => {
    const body = { abNumber: '777', name: 'Race', sponsorAbNumber: ROOT_AB, kycStatus: 'OK', status: 'ACTIVE' };
    const results = await Promise.all([a.post('/api/members', body), a.post('/api/members', body), a.post('/api/members', body)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.member.count({ where: { abNumber: '777' } })).toBe(1);
  });

  it('requires an existing Sponsor and Proposer', async () => {
    const r = await a.post('/api/members', { abNumber: '1', name: 'X', sponsorAbNumber: '424242', kycStatus: 'OK', status: 'ACTIVE' });
    expect(r.status).toBe(422);
    const r2 = await a.post('/api/members', {
      abNumber: '1', name: 'X', sponsorAbNumber: ROOT_AB, proposerAbNumber: '424242', kycStatus: 'OK', status: 'ACTIVE',
    });
    expect(r2.status).toBe(422);
    const r3 = await a.post('/api/members', { abNumber: '1', name: 'X', kycStatus: 'OK', status: 'ACTIVE' });
    expect(r3.status).toBe(422); // sponsor mandatory
  });

  it('rejects self sponsorship, self proposal and invalid AB numbers', async () => {
    await addMember(a, '100', 'Rohan', ROOT_AB);
    expect((await a.patch('/api/members/100', { sponsorAbNumber: '100' })).status).toBe(422);
    expect((await a.patch('/api/members/100', { proposerAbNumber: '100' })).status).toBe(422);
    const bad = await a.post('/api/members', { abNumber: '12AB', name: 'X', sponsorAbNumber: ROOT_AB, kycStatus: 'OK', status: 'ACTIVE' });
    expect(bad.status).toBe(422);
  });

  it('prevents sponsor cycles (A -> B -> C -> A)', async () => {
    await addMember(a, '1', 'A', ROOT_AB);
    await addMember(a, '2', 'B', '1');
    await addMember(a, '3', 'C', '2');
    const res = await a.patch('/api/members/1', { sponsorAbNumber: '3' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/loop/);
    // A valid move still works
    await addMember(a, '4', 'D', ROOT_AB);
    expect((await a.patch('/api/members/3', { sponsorAbNumber: '4' })).status).toBe(200);
  });

  it('does not let the Main Leader get a sponsor inside the network', async () => {
    await addMember(a, '1', 'A', ROOT_AB);
    expect((await a.patch(`/api/members/${ROOT_AB}`, { sponsorAbNumber: '1' })).status).toBe(400);
  });

  it('stores Sponsor and Proposer independently', async () => {
    await addMember(a, '10', 'Rahim', ROOT_AB);
    await addMember(a, '11', 'Rohan', ROOT_AB);
    await addMember(a, '12', 'Salim', '11', { proposerAbNumber: '10' });
    const p = (await a.get('/api/members/12')).body.data.member;
    expect(p.sponsor.abNumber).toBe('11');
    expect(p.proposer.abNumber).toBe('10');
    const kids = (await a.get('/api/tree/11/children')).body.data;
    expect(kids.map((k: { abNumber: string }) => k.abNumber)).toEqual(['12']);
    expect((await a.get('/api/tree/10/children')).body.data).toEqual([]);
    // Changing the proposer leaves the tree untouched
    await a.patch('/api/members/12', { proposerAbNumber: null });
    expect((await a.get('/api/members/12')).body.data.member.sponsor.abNumber).toBe('11');
  });

  it('computes network summary across all depths (spec: Rohan downline = 5)', async () => {
    await addMember(a, '100', 'Rohan', ROOT_AB);
    await addMember(a, '101', 'Mohan', '100');
    await addMember(a, '102', 'Salim', '100', { kycStatus: 'NOT_OK' });
    await addMember(a, '103', 'X', '102', { status: 'TERMINATED' });
    await addMember(a, '104', 'Karim', '100');
    await addMember(a, '105', 'Y', '104', { status: 'TERMINATED', kycStatus: 'NOT_OK' });
    const s = (await a.get('/api/members/100')).body.data.summary;
    expect(s).toEqual({ directLegs: 3, totalDownline: 5, active: 3, terminated: 2, kycNotOk: 2 });

    // Stats update automatically when status changes
    await a.patch('/api/members/103', { status: 'ACTIVE' });
    expect((await a.get('/api/members/100')).body.data.summary.terminated).toBe(1);
  });

  it('filters members by PV range, status and KYC (combinable)', async () => {
    const M = '2026-09';
    const data: [string, number, 'ACTIVE' | 'TERMINATED', 'OK' | 'NOT_OK'][] = [
      ['201', 0, 'ACTIVE', 'OK'],
      ['202', 50, 'ACTIVE', 'OK'],
      ['203', 100, 'ACTIVE', 'NOT_OK'],
      ['204', 300, 'TERMINATED', 'OK'],
      ['205', 750, 'ACTIVE', 'OK'],
      ['206', 2500, 'ACTIVE', 'OK'],
      ['207', 9000, 'ACTIVE', 'OK'],
    ];
    for (const [ab, pv, status, kyc] of data) {
      await addMember(a, ab, `M${ab}`, ROOT_AB, { status, kycStatus: kyc });
      if (pv) await setPv(a, ab, M, pv);
    }
    const abs = async (qs: string, month = M) =>
      (await a.get(`/api/members?month=${month}&pageSize=200&sort=abNumber&${qs}`)).body.data.items
        .map((i: { abNumber: string }) => i.abNumber)
        .filter((x: string) => x !== ROOT_AB);

    expect(await abs('pv=ZERO')).toEqual(['201']);
    expect(await abs('pv=0-100')).toEqual(['202', '203']);
    expect(await abs('pv=100-500')).toEqual(['204']);
    expect(await abs('pv=500-1000')).toEqual(['205']);
    expect(await abs('pv=1000-5000')).toEqual(['206']);
    expect(await abs('pv=5000%2B')).toEqual(['207']);
    expect(await abs('pv=CUSTOM&pvMin=50&pvMax=300')).toEqual(['202', '203', '204']);
    expect(await abs('pv=0-100&status=ACTIVE&kyc=OK')).toEqual(['202']);
    expect(await abs('status=TERMINATED')).toEqual(['204']);
    expect(await abs('kyc=NOT_OK')).toEqual(['203']);

    // A different month has its own values (all zero here)
    expect((await abs('pv=ZERO', '2026-08')).length).toBe(7);

    const page = (await a.get(`/api/members?month=${M}&pv=1000-5000`)).body.data;
    expect(page.total).toBe(1);
    expect(page.totalPv).toBe(2500);
  });

  it('searches by AB Number (exact first) and by partial name', async () => {
    await addMember(a, '3059', 'Kutubuddin', ROOT_AB);
    await addMember(a, '30594292', 'Sabir', ROOT_AB);
    const byAb = (await a.get('/api/members/search?q=3059')).body.data;
    expect(byAb[0].abNumber).toBe('3059');
    expect(byAb).toHaveLength(2);
    const byName = (await a.get('/api/members/search?q=tubud')).body.data;
    expect(byName.map((x: { name: string }) => x.name)).toEqual(['Kutubuddin']);
  });

  it('deletes only leaf members and never the Main Leader', async () => {
    await addMember(a, '1', 'A', ROOT_AB);
    await addMember(a, '2', 'B', '1');
    expect((await a.del('/api/members/1')).status).toBe(409);
    expect((await a.del(`/api/members/${ROOT_AB}`)).status).toBe(400);
    expect((await a.del('/api/members/2')).status).toBe(200);
    expect((await a.del('/api/members/1')).status).toBe(200);
  });

  it('returns the path from the Main Leader to a member', async () => {
    await addMember(a, '1', 'A', ROOT_AB);
    await addMember(a, '2', 'B', '1');
    const path = (await a.get('/api/tree/2/path')).body.data.path.map((p: { abNumber: string }) => p.abNumber);
    expect(path).toEqual([ROOT_AB, '1', '2']);
  });
});

describe('Manual PV update', () => {
  let a: Api;
  beforeEach(async () => {
    await resetDb();
    a = await setupLeader();
    await addMember(a, '1001', 'Rohan', ROOT_AB);
  });

  it('overwrites (does not add) and keeps other months', async () => {
    await setPv(a, '1001', '2026-08', 900);
    await setPv(a, '1001', '2026-09', 1200);
    const res = await setPv(a, '1001', '2026-09', 1850);
    expect(res.previousPv).toBe(1200);
    expect(res.currentPv).toBe(1850);
    const look = (await a.get('/api/pv/lookup?abNumber=1001&month=2026-09')).body.data;
    expect(look.currentPv).toBe(1850);
    expect(look.name).toBe('Rohan');
    expect((await a.get('/api/pv/lookup?abNumber=1001&month=2026-08')).body.data.currentPv).toBe(900);

    const audit = (await a.get('/api/members/1001/pv-audit')).body.data;
    expect(audit[0]).toMatchObject({ month: '2026-09', oldPv: 1200, newPv: 1850, source: 'MANUAL' });
  });

  it('validates PV values and months', async () => {
    expect((await a.put('/api/pv', { abNumber: '1001', month: '2026-09', pv: -5 })).status).toBe(422);
    expect((await a.put('/api/pv', { abNumber: '1001', month: '2026-09', pv: 'abc' })).status).toBe(422);
    expect((await a.put('/api/pv', { abNumber: '1001', month: '2026-13', pv: 5 })).status).toBe(422);
    expect((await a.put('/api/pv', { abNumber: '1001', month: '2999-01', pv: 5 })).status).toBe(422);
    expect((await a.put('/api/pv', { abNumber: '4040', month: '2026-09', pv: 5 })).status).toBe(404);
  });

  it('does not touch sponsor or proposer', async () => {
    await addMember(a, '1002', 'Mohan', '1001', { proposerAbNumber: ROOT_AB });
    await setPv(a, '1002', '2026-09', 10);
    const m = (await a.get('/api/members/1002')).body.data.member;
    expect(m.sponsor.abNumber).toBe('1001');
    expect(m.proposer.abNumber).toBe(ROOT_AB);
  });
});
