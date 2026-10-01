import { Router } from 'express';
import { z } from 'zod';
import { ah, ok, parse } from '../../lib/http.js';
import { getAuth } from '../../middleware/auth.js';
import { resolveMonth } from '../meta/meta.service.js';
import { pvHistory } from '../pv/pv.engine.js';
import { memberJoinings } from '../joinings/joinings.service.js';
import { recentPvAudit } from '../pv/pv.service.js';
import {
  abNumberSchema,
  createMemberSchema,
  listMembersSchema,
  updateMemberSchema,
} from './members.schemas.js';
import {
  createMember,
  deleteMember,
  findMemberOrThrow,
  getProfile,
  listMembers,
  searchMembers,
  updateMember,
} from './members.service.js';
import { prisma } from '../../lib/prisma.js';

export const membersRouter = Router();

membersRouter.get(
  '/',
  ah(async (req, res) => {
    const query = parse(listMembersSchema, req.query);
    const month = await resolveMonth(query.month);
    ok(res, await listMembers(query, month));
  }),
);

membersRouter.get(
  '/search',
  ah(async (req, res) => {
    const { q, limit } = parse(
      z.object({ q: z.string().trim().max(100).default(''), limit: z.coerce.number().int().min(1).max(25).default(10) }),
      req.query,
    );
    ok(res, await searchMembers(q, limit));
  }),
);

membersRouter.post(
  '/',
  ah(async (req, res) => {
    const input = parse(createMemberSchema, req.body);
    ok(res, await createMember(input), 201);
  }),
);

membersRouter.get(
  '/:abNumber',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    const month = await resolveMonth(req.query.month);
    ok(res, await getProfile(ab, month, getAuth(req).memberId));
  }),
);

membersRouter.patch(
  '/:abNumber',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    const input = parse(updateMemberSchema, req.body);
    ok(res, await updateMember(ab, input, getAuth(req).memberId));
  }),
);

membersRouter.delete(
  '/:abNumber',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    ok(res, await deleteMember(ab, getAuth(req).memberId));
  }),
);

membersRouter.get(
  '/:abNumber/pv-history',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    const m = await findMemberOrThrow(prisma, ab);
    ok(res, await pvHistory(m.id));
  }),
);

membersRouter.get(
  '/:abNumber/pv-audit',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    const m = await findMemberOrThrow(prisma, ab);
    ok(res, await recentPvAudit(m.id));
  }),
);

membersRouter.get(
  '/:abNumber/joinings',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    const m = await findMemberOrThrow(prisma, ab);
    ok(res, await memberJoinings(m.id, m.abNumber));
  }),
);
