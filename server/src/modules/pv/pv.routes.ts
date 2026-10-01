import { Router } from 'express';
import { z } from 'zod';
import { ah, ok, parse } from '../../lib/http.js';
import { parseYmKey } from '../../lib/months.js';
import { abNumberSchema } from '../members/members.schemas.js';
import { resolveMonth } from '../meta/meta.service.js';
import { lookupPv, manualUpdatePv } from './pv.service.js';

export const pvRouter = Router();

pvRouter.get(
  '/lookup',
  ah(async (req, res) => {
    const { abNumber } = parse(z.object({ abNumber: abNumberSchema }), req.query);
    const month = await resolveMonth(req.query.month);
    ok(res, await lookupPv(abNumber, month));
  }),
);

const updateSchema = z.object({
  abNumber: abNumberSchema,
  month: z.string().refine((v) => parseYmKey(v) !== null, 'month must be YYYY-MM'),
  pv: z.coerce
    .number({ invalid_type_error: 'PV must be a number' })
    .finite()
    .min(0, 'PV cannot be negative')
    .max(1e10, 'PV is too large'),
});

pvRouter.put(
  '/',
  ah(async (req, res) => {
    const input = parse(updateSchema, req.body);
    ok(res, await manualUpdatePv(input.abNumber, parseYmKey(input.month)!, input.pv));
  }),
);
