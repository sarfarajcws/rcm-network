import { Router } from 'express';
import { z } from 'zod';
import { validationError } from '../../lib/errors.js';
import { ah, ok, parse } from '../../lib/http.js';
import { currentYearMonth, monthRange, parseYmKey } from '../../lib/months.js';
import { abNumberSchema, monthQuery } from '../members/members.schemas.js';
import { joiningMonths, listJoinings, monthlyJoiningCounts } from './joinings.service.js';

export const joiningsRouter = Router();

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

const listSchema = z.object({
  month: monthQuery,
  from: dateStr.optional(),
  to: dateStr.optional(),
  proposer: abNumberSchema.optional(),
  q: z.string().trim().max(100).optional(),
  includeUnmapped: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

joiningsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(listSchema, req.query);
    let from: Date;
    let to: Date;
    if (q.from || q.to) {
      if (!q.from || !q.to) throw validationError('Provide both from and to dates');
      from = q.from;
      to = new Date(q.to.getTime() + 86_400_000); // inclusive end date
      if (from >= to) throw validationError('"from" must be on or before "to"');
    } else {
      const r = monthRange(q.month ? parseYmKey(q.month)! : currentYearMonth());
      from = r.start;
      to = r.end;
    }
    ok(res, await listJoinings({ from, to, proposer: q.proposer, q: q.q, includeUnmapped: q.includeUnmapped }));
  }),
);

joiningsRouter.get(
  '/months',
  ah(async (_req, res) => {
    ok(res, await joiningMonths());
  }),
);

joiningsRouter.get(
  '/trend',
  ah(async (req, res) => {
    const { month, months } = parse(
      z.object({ month: monthQuery, months: z.coerce.number().int().min(1).max(36).default(12) }),
      req.query,
    );
    ok(res, await monthlyJoiningCounts(month ? parseYmKey(month)! : currentYearMonth(), months));
  }),
);
