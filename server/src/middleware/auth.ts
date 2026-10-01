import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export interface AuthContext {
  userId: string;
  memberId: string; // the Main Leader's (root) member id
  abNumber: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface TokenPayload {
  sub: string;
  ver: number;
}

export function signToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, ver: tokenVersion } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as unknown as TokenPayload;
    } catch {
      throw unauthorized('Session expired or invalid. Please log in again.');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, tokenVersion: true, memberId: true, member: { select: { abNumber: true } } },
    });
    if (!user || user.tokenVersion !== payload.ver) {
      throw unauthorized('Session expired or invalid. Please log in again.');
    }
    req.auth = { userId: user.id, memberId: user.memberId, abNumber: user.member.abNumber };
    next();
  } catch (err) {
    next(err);
  }
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
