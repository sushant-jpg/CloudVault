import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/errors';

export const validateBody = (schema: ZodType) => (req: Request, _res: Response, next: NextFunction): void => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    next(new AppError(422, 'VALIDATION_FAILED', 'The request contains invalid values.', result.error.flatten()));
    return;
  }
  req.body = result.data;
  next();
};
