import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { ah, ok, parse } from '../../lib/http.js';
import { getAuth } from '../../middleware/auth.js';
import { abNumberSchema, kycSchema, requiredSponsorSchema, statusSchema } from '../members/members.schemas.js';
import {
  bulkCreateFromUnmapped,
  dismissUnmapped,
  importDetail,
  importHistory,
  listUnmapped,
  previewImport,
  runImport,
} from './import.service.js';

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // some browsers / OSes
  'application/zip',
  'application/x-zip-compressed',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx') return cb(badRequest('Only .xlsx Excel files are accepted (the Smart Report format).'));
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(badRequest(`Unexpected file type: ${file.mimetype}`));
    cb(null, true);
  },
});

const fySchema = z.object({
  fyStartYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const importRouter = Router();

importRouter.post(
  '/excel/preview',
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('Attach the Smart Report as "file"');
    const { fyStartYear } = parse(fySchema, req.body ?? {});
    ok(res, await previewImport(req.file.buffer, req.file.originalname, fyStartYear));
  }),
);

importRouter.post(
  '/excel',
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('Attach the Smart Report as "file"');
    const { fyStartYear } = parse(fySchema, req.body ?? {});
    const result = await runImport({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fyStartYear,
      rootMemberId: getAuth(req).memberId,
    });
    ok(res, result, 201);
  }),
);

importRouter.get(
  '/history',
  ah(async (_req, res) => {
    ok(res, await importHistory());
  }),
);

importRouter.get(
  '/unmapped',
  ah(async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    ok(res, await listUnmapped(q));
  }),
);

importRouter.post(
  '/unmapped/bulk-create',
  ah(async (req, res) => {
    const input = parse(
      // strict(): unknown keys (such as the removed placement-mode field) are rejected, so no
      // request can ask the server to derive Sponsor from Proposer.
      z
        .object({
          abNumbers: z.array(abNumberSchema).min(1).max(5000),
          sponsorAbNumber: requiredSponsorSchema,
          linkProposer: z.boolean().default(true),
          kycStatus: kycSchema,
          status: statusSchema,
        })
        .strict(),
      req.body,
    );
    ok(res, await bulkCreateFromUnmapped(input), 201);
  }),
);

importRouter.delete(
  '/unmapped/:abNumber',
  ah(async (req, res) => {
    ok(res, await dismissUnmapped(parse(abNumberSchema, req.params.abNumber)));
  }),
);

importRouter.get(
  '/:id',
  ah(async (req, res) => {
    const id = parse(z.string().min(1).max(64), req.params.id);
    ok(res, await importDetail(id));
  }),
);
