import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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

  // An upload the body parser refused. This is the caller's problem and it is
  // recoverable by sending something smaller, so it must not be reported as a server
  // fault - a 500 tells somebody to come back later, which will not help.
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'That file is too large. Keep uploads under 3MB.' } });
    return;
  }
  // Malformed JSON is likewise a bad request, not a crash.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request body was not valid JSON.' } });
    return;
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
