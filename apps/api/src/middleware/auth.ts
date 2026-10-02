import type { NextFunction, Request, Response } from 'express';
import type { Permission, UserRole } from '@cloudvault/types';
import { hasPermission } from '@cloudvault/security';
import { AppError } from '../lib/errors';
import { Session } from '../models';
import { verifyAccessToken } from '../services/auth.service';

const tokenFromRequest = (req: Request): string | undefined => {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.cloudvault_access as string | undefined;
};

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = tokenFromRequest(req);
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.');
    const auth = await verifyAccessToken(token);
    if (!(await Session.exists({ _id: auth.sessionId, userId: auth.id, revokedAt: null, expiresAt: { $gt: new Date() } }))) throw new AppError(401, 'AUTH_SESSION_REVOKED', 'This session is no longer active.');
    req.auth = auth;
    next();
  } catch (error) { next(error); }
};

export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const token = tokenFromRequest(req);
  if (!token) { next(); return; }
  try { req.auth = await verifyAccessToken(token); } catch { /* Public share remains anonymous. */ }
  next();
};

export const requirePermission = (permission: Permission) => (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.auth || !hasPermission(req.auth.role, permission)) { next(new AppError(403, 'AUTH_FORBIDDEN', 'You do not have permission to perform this action.')); return; }
  next();
};

export const requireRole = (...roles: UserRole[]) => (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.auth || !roles.includes(req.auth.role)) { next(new AppError(403, 'AUTH_FORBIDDEN', 'You do not have permission to access this resource.')); return; }
  next();
};
