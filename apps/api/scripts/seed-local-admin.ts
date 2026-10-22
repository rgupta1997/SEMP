/**
 * Creates (or resets) a super-admin on the LOCAL docker database so you can sign in.
 *
 *   npm run db:seed        # runs bootstrap-catalog.ts, then this
 *
 * Refuses to run unless DATABASE_URL points at localhost - this writes a known password.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('refusing to run: DATABASE_URL is not a local database');
  process.exit(1);
}

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@semp.local';
const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
const name = process.env.SEED_ADMIN_NAME ?? 'Local Admin';

const prisma = new PrismaClient();
const password_hash = await bcrypt.hash(password, 10);
const user = await prisma.users.upsert({
  where: { email },
  update: { password_hash, is_super_admin: true, is_active: true },
  create: { email, name, password_hash, is_super_admin: true, is_active: true },
});
console.log(`super admin ready: ${user.email} / ${password}`);
await prisma.$disconnect();
