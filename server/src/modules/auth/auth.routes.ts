import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ah, ok, parse } from '../../lib/http.js';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import { abNumberSchema, nameSchema, optionalAbNumber } from '../members/members.schemas.js';
import { changePassword, isSetupComplete, login, me, setupMainLeader } from './auth.service.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' },
  },
});

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

const optionalName = z
  .string()
  .trim()
  .max(120)
  .optional()
  .nullable()
  .transform((v) => v || null);

const setupSchema = z
  .object({
    abNumber: abNumberSchema,
    name: nameSchema,
    sponsorAbNumber: optionalAbNumber,
    sponsorName: optionalName,
    proposerAbNumber: optionalAbNumber,
    proposerName: optionalName,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const authRouter = Router();

authRouter.get(
  '/status',
  ah(async (_req, res) => {
    ok(res, { setupComplete: await isSetupComplete() });
  }),
);

authRouter.post(
  '/setup',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(setupSchema, req.body);
    ok(res, await setupMainLeader(input), 201);
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(z.object({ abNumber: abNumberSchema, password: z.string().min(1).max(128) }), req.body);
    ok(res, await login(input.abNumber, input.password));
  }),
);

authRouter.post('/logout', (_req, res) => {
  // Stateless JWT: the client discards its token.
  ok(res, { loggedOut: true });
});

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    ok(res, await me(getAuth(req).userId));
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const input = parse(
      z
        .object({ currentPassword: z.string().min(1), newPassword: passwordSchema, confirmPassword: z.string() })
        .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }),
      req.body,
    );
    ok(res, await changePassword(getAuth(req).userId, input.currentPassword, input.newPassword));
  }),
);
