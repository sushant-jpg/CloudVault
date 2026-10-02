import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && /^[a-zA-Z0-9_-]{8,128}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};
