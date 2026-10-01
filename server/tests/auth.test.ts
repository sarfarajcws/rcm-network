import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api, app, resetDb, ROOT_AB } from './helpers.js';

const setupBody = {
  abNumber: ROOT_AB,
  name: 'Main Leader',
  sponsorAbNumber: '9736085',
  sponsorName: 'IBRAHIM SHEKH',
  proposerAbNumber: '9736085',
  proposerName: 'IBRAHIM SHEKH',
  password: 'password123',
  confirmPassword: 'password123',
};

describe('Authentication & Main Leader setup', () => {
  beforeEach(resetDb);
  afterAll(async () => prisma.$disconnect());

  it('reports setup status and creates the Main Leader as a new AB (case B)', async () => {
    expect((await request(app).get('/api/auth/status')).body.data.setupComplete).toBe(false);
    const res = await request(app).post('/api/auth/setup').send(setupBody);
    expect(res.status).toBe(201);
    expect(res.body.data.linkedExistingMember).toBe(false);
    expect(res.body.data.member.isMainLeader).toBe(true);
    expect(res.body.data.member.external.sponsorAbNumber).toBe('9736085');
    expect((await request(app).get('/api/auth/status')).body.data.setupComplete).toBe(true);

    const member = await prisma.member.findUniqueOrThrow({ where: { abNumber: ROOT_AB } });
    expect(member.sponsorId).toBeNull();
    const user = await prisma.user.findFirstOrThrow();
    expect(user.passwordHash).not.toContain('password123');
    expect(user.passwordHash.startsWith('$2')).toBe(true);
  });

  it('reuses an existing AB instead of duplicating it (case A)', async () => {
    await prisma.member.create({ data: { abNumber: ROOT_AB, name: 'Existing Name', mobile: '9999999999' } });
    const res = await request(app).post('/api/auth/setup').send({ ...setupBody, name: 'Different Name' });
    expect(res.status).toBe(201);
    expect(res.body.data.linkedExistingMember).toBe(true);
    expect(await prisma.member.count({ where: { abNumber: ROOT_AB } })).toBe(1);
    const m = await prisma.member.findUniqueOrThrow({ where: { abNumber: ROOT_AB } });
    expect(m.name).toBe('Existing Name'); // preserved
    expect(m.mobile).toBe('9999999999');
  });

  it('allows only one Main Leader', async () => {
    await request(app).post('/api/auth/setup').send(setupBody);
    const again = await request(app).post('/api/auth/setup').send({ ...setupBody, abNumber: '123' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SETUP_COMPLETE');
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects mismatched passwords and short passwords', async () => {
    const r1 = await request(app).post('/api/auth/setup').send({ ...setupBody, confirmPassword: 'nope12345' });
    expect(r1.status).toBe(422);
    const r2 = await request(app).post('/api/auth/setup').send({ ...setupBody, password: 'short', confirmPassword: 'short' });
    expect(r2.status).toBe(422);
  });

  it('logs in with AB Number + password and protects private APIs', async () => {
    await request(app).post('/api/auth/setup').send(setupBody);
    const bad = await request(app).post('/api/auth/login').send({ abNumber: ROOT_AB, password: 'wrong-pass' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ abNumber: '5555', password: 'password123' });
    expect(unknown.status).toBe(401);
    const good = await request(app).post('/api/auth/login').send({ abNumber: ROOT_AB, password: 'password123' });
    expect(good.status).toBe(200);

    expect((await request(app).get('/api/members')).status).toBe(401);
    expect((await request(app).get('/api/members').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const me = await api(good.body.data.token).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.member.abNumber).toBe(ROOT_AB);
  });

  it('invalidates old tokens after a password change', async () => {
    const s = await request(app).post('/api/auth/setup').send(setupBody);
    const oldToken = s.body.data.token;
    const ch = await api(oldToken).post('/api/auth/change-password', {
      currentPassword: 'password123',
      newPassword: 'newpassword1',
      confirmPassword: 'newpassword1',
    });
    expect(ch.status).toBe(200);
    expect((await api(oldToken).get('/api/auth/me')).status).toBe(401);
    expect((await api(ch.body.data.token).get('/api/auth/me')).status).toBe(200);
  });

  it('exposes a health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.db).toBe('ok');
  });
});
