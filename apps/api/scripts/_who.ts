import 'dotenv/config';
import 'dotenv/config';
import { readFileSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const champId = JSON.parse(readFileSync(path.join(HERE,'.seed-iimb-manifest.json'),'utf8')).championships[0];
async function main(){
  const host = await prisma.users.findUnique({ where:{ email:'seed.host@iimb.test' }, select:{ id:true, name:true, email:true, is_super_admin:true } });
  const roleRows = await prisma.user_championship_roles.findMany({ where:{ championship_id: champId }, include:{ roles:{select:{name:true}}, users_user_championship_roles_user_idTousers:{select:{email:true}} } });
  console.log('championship_id:', champId);
  console.log('organizer (host):', host);
  console.log('championship roles:', roleRows.map(r=>`${r.roles.name} -> ${r.users_user_championship_roles_user_idTousers.email} (${r.user_id})`));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
