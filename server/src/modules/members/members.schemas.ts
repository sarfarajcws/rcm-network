import { z } from 'zod';
import { AB_NUMBER_RE } from '../../lib/abNumber.js';
import { parseYmKey } from '../../lib/months.js';

export const abNumberSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/\s+/g, ''))
  .refine((v) => AB_NUMBER_RE.test(v), 'AB Number must contain digits only (max 15)');

/** Sponsor is mandatory and must be chosen explicitly. */
export const requiredSponsorSchema = z
  .any()
  .refine((v) => v !== undefined && v !== null && v !== '', 'Select a Sponsor before placing this AB in the network.')
  .pipe(abNumberSchema);

export const optionalAbNumber = z
  .union([abNumberSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Name is too long')
  .refine((v) => !/[<>]/.test(v), 'Name contains invalid characters');

export const kycSchema = z.enum(['OK', 'NOT_OK']);
export const statusSchema = z.enum(['ACTIVE', 'TERMINATED']);

export const monthQuery = z
  .string()
  .optional()
  .refine((v) => v === undefined || parseYmKey(v) !== null, 'month must be YYYY-MM');

/**
 * Sponsor (tree position) is mandatory and always supplied explicitly.
 * Proposer (joining relationship) is optional and independent; the server never
 * derives one from the other. strict() rejects any unknown field.
 */
export const createMemberSchema = z
  .object({
    abNumber: abNumberSchema,
    name: nameSchema,
    kycStatus: kycSchema,
    status: statusSchema,
    sponsorAbNumber: requiredSponsorSchema,
    proposerAbNumber: optionalAbNumber,
  })
  .strict();

export const updateMemberSchema = z
  .object({
    name: nameSchema.optional(),
    kycStatus: kycSchema.optional(),
    status: statusSchema.optional(),
    sponsorAbNumber: abNumberSchema.optional(),
    proposerAbNumber: optionalAbNumber,
    externalSponsorAbNumber: optionalAbNumber,
    externalSponsorName: z.string().trim().max(120).nullable().optional(),
    externalProposerAbNumber: optionalAbNumber,
    externalProposerName: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

const pvBound = z.coerce.number().min(0).max(1e10);

export const listMembersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ALL', 'ACTIVE', 'TERMINATED']).default('ALL'),
  kyc: z.enum(['ALL', 'OK', 'NOT_OK']).default('ALL'),
  pv: z.enum(['ALL', 'ZERO', '0-100', '100-500', '500-1000', '1000-5000', '5000+', 'CUSTOM']).default('ALL'),
  pvMin: pvBound.optional(),
  pvMax: pvBound.optional(),
  month: monthQuery,
  under: abNumberSchema.optional(),
  sort: z.enum(['abNumber', 'name', 'pv', 'joiningDate']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListMembersQuery = z.infer<typeof listMembersSchema>;
