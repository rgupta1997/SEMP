import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { PlanLimitError } from '@semp/entitlements/server';
import type { Prisma as Db } from '../../infra/prisma.js';
import { DomainError } from '../../shared/errors.js';
import { notifyUsageLimitReached } from './error.notifications.js';

// Central error handler: the only place that knows HTTP status codes. A factory
// so it can notify org admins on a PlanLimitError without every one of the
// several routes that can throw one (teams, members, events, staff seats)
// having to remember to do it themselves.
export function makeErrorHandler(prisma: Db) {
  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    if (err instanceof DomainError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }

    // A plan ceiling, not a permission. 402 rather than 403 because the caller is
    // not forbidden - they may do this, they have used up how many of it their plan
    // includes. The client renders the two differently, so the codes must differ:
    // a capability wall replaces the surface, a limit wall disables one button.
    if (err instanceof PlanLimitError) {
      res.status(err.status).json({
        error: {
          code: 'PLAN_LIMIT_REACHED',
          message: err.message,
          details: { limit: err.limit, cap: err.cap, current: err.current },
        },
      });
      notifyUsageLimitReached(prisma, err);
      return;
    }

    // Map common Prisma errors to friendly responses. These are the generic CRUD
    // routes' fallback - a route with its own pre-check (e.g. invitations) throws a
    // specific BusinessRuleError before ever reaching the database, so these messages
    // are necessarily generic across every model, but they still shouldn't read like
    // a database log: no error codes, no field/table names the user never typed in.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'This already exists - it may have just been added by someone else. Refresh and try again.', details: err.meta } });
        return;
      }
      if (err.code === 'P2025') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That could not be found - it may have already been removed. Refresh and try again.' } });
        return;
      }
      if (err.code === 'P2003') {
        res.status(400).json({ error: { code: 'FK_VIOLATION', message: 'This depends on something that no longer exists. Refresh and try again.', details: err.meta } });
        return;
      }
    }

    console.error('[unhandled]', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our end. Please try again.' } });
  };
}

// Wraps async route handlers so thrown/rejected errors reach errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
