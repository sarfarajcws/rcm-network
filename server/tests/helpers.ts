import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

export const app = createApp();

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "PvAuditLog","MonthlyPv","User","UnmappedRecord","ImportBatch","Member" RESTART IDENTITY CASCADE',
  );
}

export const ROOT_AB = '9736088';

/** Runs initial setup and returns an authenticated supertest agent helper. */
export async function setupLeader(abNumber = ROOT_AB, name = 'Main Leader') {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ abNumber, name, password: 'password123', confirmPassword: 'password123' });
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
  const token = res.body.data.token as string;
  return api(token);
}

export function api(token: string) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    token,
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string, body?: object) => request(app).post(url).set(auth).send(body),
    put: (url: string, body?: object) => request(app).put(url).set(auth).send(body),
    patch: (url: string, body?: object) => request(app).patch(url).set(auth).send(body),
    del: (url: string) => request(app).delete(url).set(auth),
    upload: (url: string, file: Buffer, filename = 'report.xlsx', fields: Record<string, string> = {}) => {
      const r = request(app).post(url).set(auth);
      for (const [k, v] of Object.entries(fields)) r.field(k, v);
      return r.attach('file', file, { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },
  };
}
export type Api = ReturnType<typeof api>;

export async function addMember(
  a: Api,
  abNumber: string,
  name: string,
  sponsorAbNumber: string,
  extra: Partial<{ proposerAbNumber: string; kycStatus: 'OK' | 'NOT_OK'; status: 'ACTIVE' | 'TERMINATED' }> = {},
) {
  const res = await a.post('/api/members', {
    abNumber,
    name,
    sponsorAbNumber,
    kycStatus: extra.kycStatus ?? 'OK',
    status: extra.status ?? 'ACTIVE',
    proposerAbNumber: extra.proposerAbNumber,
  });
  if (res.status !== 201) throw new Error(`addMember ${abNumber} failed: ${JSON.stringify(res.body)}`);
  return res.body.data.member;
}

export async function setPv(a: Api, abNumber: string, month: string, pv: number) {
  const res = await a.put('/api/pv', { abNumber, month, pv });
  if (res.status !== 200) throw new Error(`setPv failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}
