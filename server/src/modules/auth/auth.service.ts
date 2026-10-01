import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { conflict, unauthorized, validationError } from '../../lib/errors.js';
import { Prisma, prisma } from '../../lib/prisma.js';
import { signToken } from '../../middleware/auth.js';
import { lockSponsorGraph } from '../network/network.repo.js';
import { absorbUnmappedRecord, toMemberDto } from '../members/members.service.js';

export async function isSetupComplete() {
  return (await prisma.user.count()) > 0;
}

export interface SetupInput {
  abNumber: string;
  name: string;
  sponsorAbNumber?: string | null;
  sponsorName?: string | null;
  proposerAbNumber?: string | null;
  proposerName?: string | null;
  password: string;
}

/**
 * Initial setup: creates the single Main Leader account.
 *  - If the AB already exists, that record is reused (never duplicated) and made
 *    the root; its existing data is preserved.
 *  - Otherwise a new member is created and becomes the root.
 */
export async function setupMainLeader(input: SetupInput) {
  if (input.sponsorAbNumber && input.sponsorAbNumber === input.abNumber)
    throw validationError('An AB cannot be its own Sponsor');
  if (input.proposerAbNumber && input.proposerAbNumber === input.abNumber)
    throw validationError('An AB cannot be its own Proposer');

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockSponsorGraph(tx);
      if ((await tx.user.count()) > 0) {
        throw conflict('Setup is already complete. Please log in.', 'SETUP_COMPLETE');
      }

      const external = {
        externalSponsorAbNumber: input.sponsorAbNumber || null,
        externalSponsorName: input.sponsorName || null,
        externalProposerAbNumber: input.proposerAbNumber || null,
        externalProposerName: input.proposerName || null,
      };

      let member = await tx.member.findUnique({
        where: { abNumber: input.abNumber },
        include: { sponsor: { select: { abNumber: true, name: true } } },
      });
      let linkedExisting = false;

      if (member) {
        // CASE A — reuse the existing AB. Keep its data; it becomes the root.
        linkedExisting = true;
        await tx.member.update({
          where: { id: member.id },
          data: {
            sponsorId: null,
            proposerId: null,
            externalSponsorAbNumber: external.externalSponsorAbNumber ?? member.sponsor?.abNumber ?? member.externalSponsorAbNumber,
            externalSponsorName: external.externalSponsorName ?? member.sponsor?.name ?? member.externalSponsorName,
            externalProposerAbNumber: external.externalProposerAbNumber ?? member.externalProposerAbNumber,
            externalProposerName: external.externalProposerName ?? member.externalProposerName,
          },
        });
      } else {
        // CASE B — create the AB as the root.
        const created = await tx.member.create({
          data: { abNumber: input.abNumber, name: input.name, ...external },
        });
        await absorbUnmappedRecord(tx, created.id, input.abNumber);
        member = await tx.member.findUniqueOrThrow({
          where: { id: created.id },
          include: { sponsor: { select: { abNumber: true, name: true } } },
        });
      }

      const user = await tx.user.create({ data: { memberId: member.id, passwordHash } });
      const full = await tx.member.findUniqueOrThrow({
        where: { id: member.id },
        include: { sponsor: true, proposer: true, user: { select: { id: true } } },
      });
      return { user, member: full, linkedExisting };
    });

    return {
      token: signToken(result.user.id, result.user.tokenVersion),
      linkedExistingMember: result.linkedExisting,
      member: toMemberDto(result.member),
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('Setup is already complete. Please log in.', 'SETUP_COMPLETE');
    }
    throw e;
  }
}

// Compare against a real hash when the AB is unknown, so response time does not
// reveal whether an account exists.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', env.BCRYPT_ROUNDS));

export async function login(abNumber: string, password: string) {
  const user = await prisma.user.findFirst({ where: { member: { abNumber } } });
  const okPassword = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !okPassword) throw unauthorized('Incorrect AB Number or password');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { token: signToken(user.id, user.tokenVersion) };
}

export async function me(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { member: { include: { sponsor: true, proposer: true, user: { select: { id: true } } } } },
  });
  return { userId: user.id, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt, member: toMemberDto(user.member) };
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw validationError('Current password is incorrect');
  const passwordHash = await bcrypt.hash(next, env.BCRYPT_ROUNDS);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
  return { token: signToken(updated.id, updated.tokenVersion) };
}
