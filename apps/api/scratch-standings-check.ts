import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { recomputeStandings } from './src/modules/standings/standings.service.js';

const prisma = new PrismaClient();

async function main() {
  const champId = '49f3933d-0668-4d42-bf12-4d3d8c6337c4';
  try {
    await recomputeStandings(prisma, champId);
    console.log('recomputeStandings ran without throwing');
  } catch (e) {
    console.log('recomputeStandings THREW:', e);
  }
  const rows = await prisma.standings.findMany({ where: { championship_id: champId } });
  console.log('Standings rows after direct call:', JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}
main();
