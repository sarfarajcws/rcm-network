import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { Prisma } from '../lib/prisma.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File is too large. Maximum size is ${env.MAX_UPLOAD_MB} MB.`
        : `Upload error: ${err.message}`;
    return res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists.' },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found' } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        success: false,
        error: { code: 'REFERENCE_ERROR', message: 'This change would break a relationship between members.' },
      });
    }
  }

  if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }

  if (!env.isTest) console.error(err);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on the server.',
      ...(env.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}
