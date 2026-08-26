import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { PlanLimitError } from '@semp/entitlements/server';
import { DomainError } from '../../shared/errors.js';

// Central error handler: the only place that knows HTTP status codes.
export function errorHandler(
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
    return;
  }

  // Map common Prisma errors to friendly responses.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Unique constraint violated', details: err.meta } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({ error: { code: 'FK_VIOLATION', message: 'Related record missing', details: err.meta } });
      return;
    }
  }

  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}

// Wraps async route handlers so thrown/rejected errors reach errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
