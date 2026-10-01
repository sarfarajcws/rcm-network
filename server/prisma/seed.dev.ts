/**
 * Development-only seed: the specification's PV example.
 *
 *   Rahim (Main Leader, password "password123")
 *   ├── Karim
 *   └── Ram
 *       └── Rina
 *           └── Rohan
 *               ├── Mohan
 *               └── Salim   (Proposer: Rahim)
 *
 * Refuses to run when NODE_ENV=production or when any member already exists.
 * Usage: npm run seed:dev
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { currentYearMonth } from '../src/lib/months.js';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Do not seed a production database.');
  if ((await prisma.member.count()) > 0) throw new Error('Database is not empty; seed skipped.');

  const { year, month } = currentYearMonth();
  const mk = (abNumber: string, name: string, sponsorId: string | null, proposerId: string | null = null) =>
    prisma.member.create({ data: { abNumber, name, sponsorId, proposerId } });

  const rahim = await mk('1000', 'Rahim', null);
  await prisma.user.create({ data: { memberId: rahim.id, passwordHash: await bcrypt.hash('password123', 10) } });
  const karim = await mk('1001', 'Karim', rahim.id);
  const ram = await mk('1002', 'Ram', rahim.id);
  const rina = await mk('1003', 'Rina', ram.id);
  const rohan = await mk('1004', 'Rohan', rina.id);
  const mohan = await mk('1005', 'Mohan', rohan.id);
  const salim = await mk('1006', 'Salim', rohan.id, rahim.id);

  const pv: [string, number][] = [
    [rahim.id, 5000], [ram.id, 2000], [karim.id, 1000], [rohan.id, 3000], [mohan.id, 1500], [salim.id, 2500], [rina.id, 0],
  ];
  await prisma.monthlyPv.createMany({ data: pv.map(([memberId, selfPv]) => ({ memberId, year, month, selfPv, source: 'MANUAL' as const })) });
  console.log('Seeded example network. Log in with AB 1000 / password123');
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
