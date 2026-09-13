import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { PlanLimitError } from '@semp/entitlements/server';
import type { Prisma as Db } from '../../infra/prisma.js';
import { DomainError } from '../../shared/errors.js';
import { notifyUsageLimitReached } from './error.notifications.js';

export interface FriendlyError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Turn any thrown value into a user-facing status/code/message - the one place
 * that decides what a person is told, independent of HTTP.
 *
 * Pulled out of `errorHandler` so a caller that catches an error ITSELF (rather
 * than letting it reach Express's error middleware) can still get the same
 * translation. Bulk operations are exactly this shape: `lockScorecardsBulk`
 * catches each fixture's failure individually so one bad card can't stop the
 * other forty-nine, and used to store the raw exception message straight into
 * its per-item result - so a transaction timeout's Prisma internals (a P2028,
 * with its "31135 ms passed" stack trace) went out in a toast verbatim, the
 * very thing the whole friendly-message effort here exists to prevent. Only
 * the single request/response path went through errorHandler; anything caught
 * and swallowed mid-loop bypassed it entirely.
 *
 * Deliberately pure - no `prisma`, no side effects. `PlanLimitError`'s admin
 * notification stays in `makeErrorHandler` below, where there is exactly one
 * HTTP response being made; a bulk loop calling this per-item must not fire an
 * admin notification once per failed row in the same batch.
 */
export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof DomainError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  // A plan ceiling, not a permission. 402 rather than 403 because the caller is
  // not forbidden - they may do this, they have used up how many of it their plan
  // includes. The client renders the two differently, so the codes must differ:
  // a capability wall replaces the surface, a limit wall disables one button.
  if (err instanceof PlanLimitError) {
    return {
      status: err.status,
      code: 'PLAN_LIMIT_REACHED',
      message: err.message,
      details: { limit: err.limit, cap: err.cap, current: err.current },
    };
  }

  // The database itself was unreachable (connection refused, DNS failure, auth
  // rejected, pool exhausted) - Prisma throws this at CONNECTION time, before it
  // ever gets to run a query, so it's a different class entirely from the
  // query-level errors below. Distinct from "something went wrong on our end":
  // that phrasing is for a genuine bug; this is a known, nameable condition (most
  // often the API process itself losing its route to the DB host) that deserves
  // its own message rather than being lumped into the generic catch-all.
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return { status: 503, code: 'DATABASE_UNREACHABLE', message: 'Trouble connecting. Please try again.' };
  }

  // Map common Prisma errors to friendly responses. These are the generic CRUD
  // routes' fallback - a route with its own pre-check (e.g. invitations) throws a
  // specific BusinessRuleError before ever reaching the database, so these messages
  // are necessarily generic across every model, but they still shouldn't read like
  // a database log: no error codes, no field/table names the user never typed in.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return { status: 409, code: 'CONFLICT', message: 'This already exists. Refresh and try again.', details: err.meta };
    }
    if (err.code === 'P2025') {
      return { status: 404, code: 'NOT_FOUND', message: 'That could not be found - it may have already been removed. Refresh and try again.' };
    }
    if (err.code === 'P2003') {
      return { status: 400, code: 'FK_VIOLATION', message: 'This depends on something that no longer exists. Refresh and try again.', details: err.meta };
    }
    // The transaction's own timeout was hit and Prisma killed it mid-write -
    // distinct from every case above, which fail on the DATA. This fails on
    // TIME: nothing about it is wrong except that it took too long, and nothing
    // it wrote survives (the whole transaction rolled back), so retrying is
    // both safe and often literally sufficient (a slow connection that has
    // since cleared, a one-off contention spike).
    if (err.code === 'P2028') {
      return { status: 504, code: 'TIMEOUT', message: 'That took too long and was not saved. Please try again.' };
    }
  }

  console.error('[unhandled]', err);
  return { status: 500, code: 'INTERNAL', message: 'Something went wrong on our end. Please try again.' };
}

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
    const f = friendlyError(err);
    if (err instanceof PlanLimitError) notifyUsageLimitReached(prisma, err);
    res.status(f.status).json({ error: { code: f.code, message: f.message, details: f.details } });
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
