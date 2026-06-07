import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { loginSchema, registerSchema, signupSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireAuth, signToken } from '../../http/middleware/auth.js';
import { NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { buildAuthContext } from './me-context.js';

function publicUser(u: any) {
  const { password_hash, ...rest } = u;
  return rest;
}

function tokenFor(u: any): string {
  return signToken({
    id: u.id,
    email: u.email,
    isSuperAdmin: u.is_super_admin,
    accountType: u.account_type,
    institutionId: u.institution_id ?? null,
  });
}

export function makeAuthRouter(prisma: Prisma): Router {
  const router = Router();

  router.post('/login', validateBody(loginSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user || !user.password_hash) throw new UnauthorizedError('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');
    const context = await buildAuthContext(prisma, user);
    res.json({ token: tokenFor(user), ...context });
  }));

  // Creates a normal (non-admin) user with a password. Used to onboard captains/players.
  router.post('/register', validateBody(registerSchema), asyncHandler(async (req, res) => {
    const { name, email, password, phone } = req.body;
    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.create({
      data: { name, email, phone, password_hash, is_super_admin: false },
    });
    const context = await buildAuthContext(prisma, user);
    res.status(201).json({ token: tokenFor(user), ...context });
  }));

  // Self-serve sign up — picks an account type and (for institution accounts)
  // joins or creates an institution.
  router.post('/signup', validateBody(signupSchema), asyncHandler(async (req, res) => {
    const { name, email, password, phone, account_type, institution_id, institution_name } = req.body;

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) throw new UnauthorizedError('An account with this email already exists');

    let institutionId: string | null = null;
    if (account_type === 'institution') {
      if (institution_id) {
        institutionId = institution_id;
      } else if (institution_name) {
        const inst = await prisma.institutions.create({ data: { name: institution_name, status: true } });
        institutionId = inst.id;
      }
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.create({
      data: {
        name, email, phone, password_hash,
        is_super_admin: false,
        account_type,
        institution_id: institutionId,
      },
    });
    const context = await buildAuthContext(prisma, user);
    res.status(201).json({ token: tokenFor(user), ...context });
  }));

  router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await prisma.users.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new NotFoundError('User');
    const context = await buildAuthContext(prisma, user);
    res.json(context);
  }));

  return router;
}

export { publicUser };
