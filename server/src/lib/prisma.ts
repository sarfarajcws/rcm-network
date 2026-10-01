import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Db = typeof prisma | Tx;

export { Prisma } from '../generated/prisma/client.js';
export type { Member, MonthlyPv } from '../generated/prisma/client.js';
export { KycStatus, MemberStatus, PvSource, ImportStatus } from '../generated/prisma/enums.js';
