import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main(){
  const u = await prisma.users.update({ where:{ email:'seed.host@iimb.test' }, data:{ is_super_admin:false }, select:{ id:true, email:true, is_super_admin:true } });
  // confirm they still organise this championship (gives manage + score rights)
  const roles = await prisma.user_championship_roles.findMany({ where:{ user_id:u.id }, include:{ roles:{select:{name:true}} } });
  console.log('updated:', u);
  console.log('championship roles:', roles.map(r=>r.roles.name).join(', '));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
