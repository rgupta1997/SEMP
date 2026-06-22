import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { changePasswordSchema, loginSchema, registerSchema, signupSchema } from '@semp/shared';
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
    organizationId: u.organization_id ?? null,
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

  // Self-serve sign up - every login is just a user. Hosting a championship,
  // creating/joining an organization, or being assigned as an official are all
  // separate actions taken after sign-up.
  router.post('/signup', validateBody(signupSchema), asyncHandler(async (req, res) => {
    const { name, email, password, phone } = req.body;

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) throw new UnauthorizedError('An account with this email already exists');

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.create({
      data: { name, email, phone, password_hash, is_super_admin: false },
    });
    const context = await buildAuthContext(prisma, user);
    res.status(201).json({ token: tokenFor(user), ...context });
  }));

  router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await prisma.users.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new NotFoundError('User');
    const context = await buildAuthContext(prisma, user);
    // Identity/permissions are per-user and change (roles, must_change_password,
    // org membership). Never let the browser cache or 304-revalidate it - always
    // serve a fresh 200 so a stale context can't linger after those change.
    res.set('Cache-Control', 'no-store');
    res.json(context);
  }));

  // Change your own password. Provisioned users (must_change_password) skip the
  // current-password check - they just authenticated with the temporary one. A
  // normal change requires the current password. Clears the must-change flag.
  router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body as { current_password?: string; new_password: string };
    const user = await prisma.users.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.password_hash) throw new UnauthorizedError('Invalid credentials');

    if (!user.must_change_password) {
      const ok = current_password ? await bcrypt.compare(current_password, user.password_hash) : false;
      if (!ok) throw new UnauthorizedError('Current password is incorrect');
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    const updated = await prisma.users.update({
      where: { id: user.id },
      data: { password_hash, must_change_password: false },
    });
    const context = await buildAuthContext(prisma, updated);
    res.json(context);
  }));

  return router;
}

export { publicUser };
