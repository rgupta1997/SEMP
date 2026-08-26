import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const sql = process.argv.slice(2).join(' ');
  console.table(await p.$queryRawUnsafe<any[]>(sql));
  await p.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
