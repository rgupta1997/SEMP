import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors.js';
import type { AuthUser } from './types.js';

export interface JwtPayload {
  sub: string;
  email: string;
  isSuperAdmin: boolean;
  organizationId: string | null;
}

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    organizationId: user.organizationId,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

// Parses the Bearer token if present; does not reject.
export function parseAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.slice(7), env.JWT_SECRET) as JwtPayload & { aud?: unknown };

      // A session token has no audience. Anything that does was minted for some
      // other purpose, and the only such token in this system is the AppSync
      // realtime token (modules/notifications/realtime-token.ts).
      //
      // That token is already signed with an HKDF-DERIVED key, so it cannot verify
      // above and this branch should be unreachable. It is here because the
      // derivation is one refactor away from being "simplified" back to
      // env.JWT_SECRET, and the consequence would be invisible: `jwt.verify` takes
      // no audience option by default, so every realtime token the mint endpoint
      // hands out would silently become a working API session. Two independent
      // fences, because the failure mode has no symptom.
      if (decoded.aud !== undefined) return next();

      req.user = {
        id: decoded.sub,
        email: decoded.email,
        isSuperAdmin: decoded.isSuperAdmin,
        organizationId: decoded.organizationId ?? null,
      };
    } catch {
      /* invalid token -> treated as anonymous */
    }
  }
  next();
}

// Requires a valid authenticated user.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError();
  next();
}

// Requires the platform super-admin (Phase 1). Currently the only role in use.
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError();
  if (!req.user.isSuperAdmin) throw new ForbiddenError('Super admin required');
  next();
}
