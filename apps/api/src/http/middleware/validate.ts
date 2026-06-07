import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../../shared/errors.js';

// Validates & replaces req.body with the parsed (defaulted/coerced) value.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Invalid request body', result.error.flatten());
    }
    req.body = result.data;
    next();
  };
}
