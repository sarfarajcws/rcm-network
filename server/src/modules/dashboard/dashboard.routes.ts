import { Router } from 'express';
import { ah, ok } from '../../lib/http.js';
import { getAuth } from '../../middleware/auth.js';
import { availableMonths, resolveMonth } from '../meta/meta.service.js';
import { dashboard } from './dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  ah(async (req, res) => {
    ok(res, await dashboard(getAuth(req).memberId, await resolveMonth(req.query.month)));
  }),
);

export const metaRouter = Router();

metaRouter.get(
  '/months',
  ah(async (_req, res) => {
    ok(res, await availableMonths());
  }),
);
