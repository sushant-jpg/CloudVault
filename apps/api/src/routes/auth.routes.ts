import { Router } from 'express';
import { getConfig } from '@cloudvault/config';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema, resetPasswordSchema, resetRequestSchema } from '@cloudvault/validation';
import { authenticate } from '../middleware/auth';
import { authRateLimit, sensitiveRateLimit } from '../middleware/rate-limit';
import { validateBody } from '../middleware/validate';
import { AppError } from '../lib/errors';
import { Session } from '../models';
import {
  changePassword, confirmTwoFactorSetup, disableTwoFactor, login, register, requestPasswordReset,
  resetPassword, revokeAllSessions, revokeSession, rotateRefreshToken, startTwoFactorSetup, verifyEmail
} from '../services/auth.service';
import { writeAudit } from '../services/audit.service';

export const authRouter = Router();
const config = getConfig();
const context = (req: Parameters<typeof authRouter.post>[1] extends never ? never : import('express').Request) => ({
  ip: req.ip ?? 'unknown', userAgent: req.get('user-agent') ?? 'unknown', device: req.get('sec-ch-ua') ?? req.get('user-agent') ?? 'unknown', requestId: req.requestId
});
const setAuthCookies = (res: import('express').Response, tokens: { accessToken: string; refreshToken: string }) => {
  const base = { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  res.cookie('cloudvault_access', tokens.accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('cloudvault_refresh', tokens.refreshToken, { ...base, maxAge: config.JWT_REFRESH_TTL_DAYS * 86_400_000 });
};
const clearAuthCookies = (res: import('express').Response) => {
  res.clearCookie('cloudvault_access', { path: '/' });
  res.clearCookie('cloudvault_refresh', { path: '/' });
};

authRouter.post('/register', authRateLimit, validateBody(registerSchema), async (req, res) => {
  const result = await register(req.body);
  res.status(201).json({ success: true, data: result });
});

authRouter.post('/verify-email', sensitiveRateLimit, async (req, res) => {
  if (typeof req.body.token !== 'string') throw new AppError(422, 'VALIDATION_FAILED', 'A verification token is required.');
  await verifyEmail(req.body.token);
  res.json({ success: true, data: { verified: true } });
});

authRouter.post('/login', authRateLimit, validateBody(loginSchema), async (req, res) => {
  const result = await login(req.body, context(req));
  setAuthCookies(res, result.tokens);
  req.auth = { id: result.user.id, email: result.user.email, role: result.user.role, sessionId: result.tokens.sessionId };
  await writeAudit(req, 'LOGIN_SUCCESS', 'session', result.tokens.sessionId);
  res.json({ success: true, data: { user: result.user, accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn } });
});

authRouter.post('/refresh', authRateLimit, validateBody(refreshSchema), async (req, res) => {
  const rawToken = req.body.refreshToken ?? req.cookies?.cloudvault_refresh;
  if (!rawToken) throw new AppError(401, 'AUTH_INVALID_TOKEN', 'A refresh token is required.');
  const tokens = await rotateRefreshToken(rawToken, context(req));
  setAuthCookies(res, tokens);
  res.json({ success: true, data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn } });
});

authRouter.post('/logout', authenticate, async (req, res) => {
  await revokeSession(req.auth!.sessionId, req.auth!.id);
  clearAuthCookies(res);
  res.status(204).send();
});

authRouter.post('/forgot-password', sensitiveRateLimit, validateBody(resetRequestSchema), async (req, res) => {
  const developmentToken = await requestPasswordReset(req.body.email);
  res.json({ success: true, data: { message: 'If the account exists, password reset instructions have been sent.', ...(developmentToken ? { developmentToken } : {}) } });
});

authRouter.post('/reset-password', sensitiveRateLimit, validateBody(resetPasswordSchema), async (req, res) => {
  await resetPassword(req.body.token, req.body.password);
  clearAuthCookies(res);
  res.json({ success: true, data: { changed: true } });
});

authRouter.post('/change-password', authenticate, sensitiveRateLimit, validateBody(changePasswordSchema), async (req, res) => {
  await changePassword(req.auth!.id, req.body.currentPassword, req.body.newPassword);
  clearAuthCookies(res);
  res.json({ success: true, data: { changed: true, sessionsRevoked: true } });
});

authRouter.get('/me', authenticate, async (req, res) => res.json({ success: true, data: { user: req.auth } }));

authRouter.get('/sessions', authenticate, async (req, res) => {
  const sessions = await Session.find({ userId: req.auth!.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastActivityAt: -1 }).select('-tokenHash');
  res.json({ success: true, data: { sessions, currentSessionId: req.auth!.sessionId } });
});

authRouter.delete('/sessions/:id', authenticate, sensitiveRateLimit, async (req, res) => {
  const sessionId = String(req.params.id);
  if (!(await revokeSession(sessionId, req.auth!.id, 'USER_REVOKED'))) throw new AppError(404, 'SESSION_NOT_FOUND', 'The active session was not found.');
  res.status(204).send();
});

authRouter.delete('/sessions', authenticate, sensitiveRateLimit, async (req, res) => {
  const count = await revokeAllSessions(req.auth!.id);
  clearAuthCookies(res);
  res.json({ success: true, data: { revokedSessions: count } });
});

authRouter.post('/2fa/setup', authenticate, sensitiveRateLimit, async (req, res) => {
  if (typeof req.body.password !== 'string') throw new AppError(422, 'VALIDATION_FAILED', 'Your password is required.');
  res.json({ success: true, data: await startTwoFactorSetup(req.auth!.id, req.body.password) });
});

authRouter.post('/2fa/verify', authenticate, sensitiveRateLimit, async (req, res) => {
  if (typeof req.body.code !== 'string') throw new AppError(422, 'VALIDATION_FAILED', 'A verification code is required.');
  const result = await confirmTwoFactorSetup(req.auth!.id, req.body.code);
  await writeAudit(req, 'TWO_FACTOR_ENABLED', 'user', req.auth!.id);
  res.json({ success: true, data: result });
});

authRouter.post('/2fa/disable', authenticate, sensitiveRateLimit, async (req, res) => {
  if (typeof req.body.password !== 'string' || typeof req.body.code !== 'string') throw new AppError(422, 'VALIDATION_FAILED', 'Password and verification code are required.');
  await disableTwoFactor(req.auth!.id, req.body.password, req.body.code);
  await writeAudit(req, 'TWO_FACTOR_DISABLED', 'user', req.auth!.id);
  res.json({ success: true, data: { disabled: true } });
});
