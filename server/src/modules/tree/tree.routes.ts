import { Router } from 'express';
import { ah, ok, parse } from '../../lib/http.js';
import { getAuth } from '../../middleware/auth.js';
import { abNumberSchema } from '../members/members.schemas.js';
import { resolveMonth } from '../meta/meta.service.js';
import { getChildren, getNode, getPath } from './tree.service.js';

export const treeRouter = Router();

/** The Main Leader's node (tree root). */
treeRouter.get(
  '/root',
  ah(async (req, res) => {
    const month = await resolveMonth(req.query.month);
    ok(res, await getNode(getAuth(req).abNumber, month));
  }),
);

treeRouter.get(
  '/:abNumber',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    ok(res, await getNode(ab, await resolveMonth(req.query.month)));
  }),
);

/** Lazy-loaded direct children of a node. */
treeRouter.get(
  '/:abNumber/children',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    ok(res, await getChildren(ab, await resolveMonth(req.query.month)));
  }),
);

treeRouter.get(
  '/:abNumber/path',
  ah(async (req, res) => {
    const ab = parse(abNumberSchema, req.params.abNumber);
    ok(res, await getPath(ab, getAuth(req).memberId));
  }),
);
