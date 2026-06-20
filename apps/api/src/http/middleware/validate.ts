import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../../shared/errors.js';

// Validates & replaces req.body with the parsed (defaulted/coerced) value.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Surface the first field-level issue as the message so clients show a
      // specific, actionable error (e.g. "Phone number is required") instead of
      // a generic one. Full per-field details are still attached.
      const issue = result.error.issues[0];
      const field = issue?.path.join('.');
      const message = issue
        ? (field ? `${field}: ${issue.message}` : issue.message)
        : 'Invalid request body';
      throw new ValidationError(message, result.error.flatten());
    }
    req.body = result.data;
    next();
  };
}
