import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { addMember, type Api, resetDb, setPv, setupLeader } from './helpers.js';

/**
 * The specification's worked example:
 *
 *                 Rahim (root)
 *               /       \
 *           Karim       Ram
 *                        |
 *                       Rina
 *                        |
 *                      Rohan
 *                     /     \
 *                  Mohan    Salim
 */
const AB = { Rahim: '1000', Karim: '1001', Ram: '1002', Rina: '1003', Rohan: '1004', Mohan: '1005', Salim: '1006' };
const M = '2026-09';

describe('PV engine (spec example)', () => {
  let a: Api;

  beforeAll(async () => {
    await resetDb();
    a = await setupLeader(AB.Rahim, 'Rahim');
    await addMember(a, AB.Karim, 'Karim', AB.Rahim);
    await addMember(a, AB.Ram, 'Ram', AB.Rahim);
    await addMember(a, AB.Rina, 'Rina', AB.Ram);
    await addMember(a, AB.Rohan, 'Rohan', AB.Rina);
    await addMember(a, AB.Mohan, 'Mohan', AB.Rohan);
    await addMember(a, AB.Salim, 'Salim', AB.Rohan, { proposerAbNumber: AB.Rahim });
    await setPv(a, AB.Rahim, M, 5000);
    await setPv(a, AB.Ram, M, 2000);
    await setPv(a, AB.Karim, M, 1000);
    await setPv(a, AB.Rohan, M, 3000);
    await setPv(a, AB.Mohan, M, 1500);
    await setPv(a, AB.Salim, M, 2500);
    await setPv(a, AB.Rina, M, 0);
  });
  afterAll(async () => prisma.$disconnect());

  const total = async (ab: string) => (await a.get(`/api/members/${ab}?month=${M}`)).body.data.pv;

  it.each([
    ['Rahim', 15000],
    ['Ram', 9000],
    ['Rohan', 7000],
    ['Karim', 1000],
    ['Mohan', 1500],
    ['Salim', 2500],
    ['Rina', 7000],
  ] as const)('%s total PV = %d', async (who, expected) => {
    expect((await total(AB[who])).totalPv).toBe(expected);
  });

  it('Rahim has two legs: Karim (1,000) and Ram (9,000)', async () => {
    const pv = await total(AB.Rahim);
    expect(pv.selfPv).toBe(5000);
    expect(pv.legs.map((l: { name: string; pv: number }) => [l.name, l.pv])).toEqual([
      ['Karim', 1000],
      ['Ram', 9000],
    ]);
  });

  it('Karim receives nothing from the unrelated Ram branch', async () => {
    const pv = await total(AB.Karim);
    expect(pv.legs).toEqual([]);
    expect(pv.groupPv).toBe(0);
  });

  it('Rohan legs are Mohan and Salim', async () => {
    const pv = await total(AB.Rohan);
    expect(pv.legs.map((l: { name: string; pv: number }) => [l.name, l.pv])).toEqual([
      ['Mohan', 1500],
      ['Salim', 2500],
    ]);
  });

  it('supports any number of direct legs (no binary assumption)', async () => {
    for (const [i, ab] of ['2001', '2002', '2003'].entries()) {
      await addMember(a, ab, `Leg${i + 3}`, AB.Rohan);
      await setPv(a, ab, M, 100 * (i + 1));
    }
    const pv = await total(AB.Rohan);
    expect(pv.legs).toHaveLength(5);
    expect(pv.legs.map((l: { index: number }) => l.index)).toEqual([1, 2, 3, 4, 5]);
    expect(pv.totalPv).toBe(7000 + 600);
    // Upstream totals include the new members too
    expect((await total(AB.Rahim)).totalPv).toBe(15600);
    expect((await total(AB.Karim)).totalPv).toBe(1000);
  });

  it('proposer does not affect tree position or PV (Salim proposed by Rahim, sponsored by Rohan)', async () => {
    const res = await a.get(`/api/members/${AB.Salim}?month=${M}`);
    expect(res.body.data.member.sponsor.abNumber).toBe(AB.Rohan);
    expect(res.body.data.member.proposer.abNumber).toBe(AB.Rahim);
    expect(res.body.data.upline.map((u: { name: string }) => u.name)).toEqual(['Rahim', 'Ram', 'Rina', 'Rohan']);
  });

  it('month-wise PV keeps months separate', async () => {
    await setPv(a, AB.Mohan, '2026-08', 400);
    const hist = (await a.get(`/api/members/${AB.Rohan}/pv-history`)).body.data;
    const aug = hist.months.find((m: { month: string }) => m.month === '2026-08');
    const sep = hist.months.find((m: { month: string }) => m.month === M);
    expect(aug.totalPv).toBe(400);
    expect(aug.legs[0].pv).toBe(400);
    expect(sep.totalPv).toBe(7600);
    expect(hist.legs).toHaveLength(5);
  });

  it('tree children return subtree totals per node', async () => {
    const kids = (await a.get(`/api/tree/${AB.Rahim}/children?month=${M}`)).body.data;
    expect(kids.map((k: { name: string; totalPv: number; downlineCount: number }) => [k.name, k.totalPv, k.downlineCount])).toEqual([
      ['Karim', 1000, 0],
      ['Ram', 9600, 7],
    ]);
  });
});
