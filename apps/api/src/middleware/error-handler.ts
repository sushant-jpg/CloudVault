import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { apiError } from '@cloudvault/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFound: RequestHandler = (req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', `No route exists for ${req.method} ${req.path}.`));

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(apiError(error.code, error.message, req.requestId));
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json(apiError('VALIDATION_FAILED', 'The request contains invalid values.', req.requestId));
    return;
  }
  logger.error({ err: error, requestId: req.requestId }, 'Unhandled request error');
  res.status(500).json(apiError('INTERNAL_ERROR', 'The request could not be completed.', req.requestId));
};
