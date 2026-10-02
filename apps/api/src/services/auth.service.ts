import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import { getConfig } from '@cloudvault/config';
import { createOpaqueToken, sha256 } from '@cloudvault/security';
import type { AuthenticatedUser, UserRole } from '@cloudvault/types';
import type { LoginInput, RegisterInput } from '@cloudvault/validation';
import { AppError } from '../lib/errors';
import { SecurityEvent, Session, User } from '../models';

const config = getConfig();
const accessSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

const passwordOptions: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1
};

interface ClientContext { ip: string; userAgent: string; device: string; requestId: string }
interface AuthTokens { accessToken: string; refreshToken: string; sessionId: string; expiresIn: number }

const signAccessToken = async (userId: string, email: string, role: UserRole, sessionId: string): Promise<string> =>
  new SignJWT({ email, role, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('cloudvault-api')
    .setAudience('cloudvault-web')
    .setIssuedAt()
    .setExpirationTime(config.JWT_ACCESS_TTL)
    .sign(accessSecret);

const createSessionTokens = async (user: { id: string; email: string; role: UserRole }, context: ClientContext, familyId: string = randomUUID()): Promise<AuthTokens> => {
  const refreshToken = createOpaqueToken(48);
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 86_400_000);
  const session = await Session.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    familyId,
    device: context.device,
    ip: context.ip,
    userAgent: context.userAgent,
    expiresAt
  });
  const accessToken = await signAccessToken(user.id, user.email, user.role, session.id);
  return { accessToken, refreshToken, sessionId: session.id, expiresIn: 900 };
};

const verifyRecoveryCode = async (userId: string, code: string, hashes: string[]): Promise<boolean> => {
  for (const hash of hashes) {
    if (await argon2.verify(hash, code)) {
      await User.updateOne({ _id: userId }, { $pull: { recoveryCodeHashes: hash } });
      return true;
    }
  }
  return false;
};

export const register = async (input: RegisterInput): Promise<{ user: { id: string; email: string; name: string }; verificationToken?: string }> => {
  if (await User.exists({ email: input.email })) throw new AppError(409, 'AUTH_EMAIL_IN_USE', 'An account with this email already exists.');
  const verificationToken = createOpaqueToken();
  const user = await User.create({
    email: input.email,
    name: input.name,
    passwordHash: await argon2.hash(input.password, passwordOptions),
    emailVerificationTokenHash: sha256(verificationToken),
    emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  return {
    user: { id: user.id, email: user.email, name: user.name },
    ...(config.NODE_ENV === 'development' ? { verificationToken } : {})
  };
};

export const verifyEmail = async (token: string): Promise<void> => {
  const user = await User.findOneAndUpdate(
    { emailVerificationTokenHash: sha256(token), emailVerificationExpiresAt: { $gt: new Date() } },
    { $set: { emailVerified: true }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } }
  );
  if (!user) throw new AppError(400, 'AUTH_VERIFICATION_INVALID', 'The verification link is invalid or expired.');
};

export const login = async (input: LoginInput, context: ClientContext): Promise<{ tokens: AuthTokens; user: { id: string; email: string; name: string; role: UserRole; twoFactorEnabled: boolean } }> => {
  const user = await User.findOne({ email: input.email }).select('+passwordHash +twoFactorSecretEncrypted +recoveryCodeHashes');
  const generic = new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email, password, or verification code is invalid.');
  if (!user) throw generic;
  if (user.lockUntil && user.lockUntil > new Date()) throw new AppError(423, 'AUTH_ACCOUNT_LOCKED', 'This account is temporarily locked.');
  if (!(await argon2.verify(user.passwordHash, input.password))) {
    const failures = user.failedLoginCount + 1;
    await User.updateOne({ _id: user.id }, { $set: { failedLoginCount: failures, ...(failures >= 5 ? { lockUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}) } });
    if (failures >= 5) await SecurityEvent.create({ type: 'MULTIPLE_LOGIN_FAILURES', severity: 'HIGH', userId: user.id, ip: context.ip, device: context.device, requestId: context.requestId, metadata: { failures } });
    throw generic;
  }
  if (user.twoFactorEnabled) {
    if (!input.totpCode && !input.recoveryCode) throw new AppError(401, 'AUTH_2FA_REQUIRED', 'A two-factor verification code is required.');
    const totpValid = input.totpCode && user.twoFactorSecretEncrypted ? authenticator.check(input.totpCode, decryptSecret(user.twoFactorSecretEncrypted)) : false;
    const recoveryValid = input.recoveryCode ? await verifyRecoveryCode(user.id, input.recoveryCode, user.recoveryCodeHashes) : false;
    if (!totpValid && !recoveryValid) throw generic;
  }
  await User.updateOne({ _id: user.id }, { $set: { failedLoginCount: 0 }, $unset: { lockUntil: 1 } });
  const role = user.role as UserRole;
  return {
    tokens: await createSessionTokens({ id: user.id, email: user.email, role }, context),
    user: { id: user.id, email: user.email, name: user.name, role, twoFactorEnabled: user.twoFactorEnabled }
  };
};

export const verifyAccessToken = async (token: string): Promise<AuthenticatedUser> => {
  try {
    const { payload } = await jwtVerify(token, accessSecret, { issuer: 'cloudvault-api', audience: 'cloudvault-web' });
    if (!payload.sub || typeof payload.email !== 'string' || typeof payload.role !== 'string' || typeof payload.sid !== 'string') throw new Error('Missing claims');
    return { id: payload.sub, email: payload.email, role: payload.role as UserRole, sessionId: payload.sid };
  } catch {
    throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Authentication is required.');
  }
};

export const rotateRefreshToken = async (rawToken: string, context: ClientContext): Promise<AuthTokens> => {
  const tokenHash = sha256(rawToken);
  const session = await Session.findOne({ tokenHash }).select('+tokenHash');
  if (!session) throw new AppError(401, 'AUTH_INVALID_TOKEN', 'The session is invalid.');
  if (session.revokedAt) {
    await Session.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE' } });
    await SecurityEvent.create({ type: 'SESSION_TOKEN_REUSE', severity: 'CRITICAL', userId: session.userId, ip: context.ip, device: context.device, requestId: context.requestId });
    throw new AppError(401, 'AUTH_TOKEN_REUSE', 'Session token reuse was detected; this device family has been revoked.');
  }
  if (session.expiresAt <= new Date()) throw new AppError(401, 'AUTH_SESSION_EXPIRED', 'The session has expired.');
  const claimed = await Session.findOneAndUpdate({ _id: session.id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'ROTATED', lastActivityAt: new Date() } });
  if (!claimed) throw new AppError(401, 'AUTH_TOKEN_REUSE', 'This refresh token has already been used.');
  const user = await User.findById(session.userId);
  if (!user) throw new AppError(401, 'AUTH_INVALID_TOKEN', 'The session is invalid.');
  const tokens = await createSessionTokens({ id: user.id, email: user.email, role: user.role as UserRole }, context, session.familyId);
  await Session.updateOne({ _id: session.id }, { $set: { replacedBySessionId: tokens.sessionId } });
  return tokens;
};

export const revokeSession = async (sessionId: string, userId: string, reason = 'USER_LOGOUT'): Promise<boolean> => {
  const result = await Session.updateOne({ _id: sessionId, userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return result.modifiedCount === 1;
};

export const revokeAllSessions = async (userId: string, reason = 'LOGOUT_ALL'): Promise<number> => {
  const result = await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return result.modifiedCount;
};

const encryptionKey = (): Buffer => {
  const raw = config.TOTP_ENCRYPTION_KEY;
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : Buffer.from(sha256(raw), 'hex');
};

const encryptSecret = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
};

const decryptSecret = (value: string): string => {
  const [ivText, tagText, dataText] = value.split('.');
  if (!ivText || !tagText || !dataText) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
};

export const startTwoFactorSetup = async (userId: string, password: string): Promise<{ secret: string; otpauthUrl: string }> => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await argon2.verify(user.passwordHash, password))) throw new AppError(401, 'AUTH_REAUTH_REQUIRED', 'Your password could not be verified.');
  const secret = authenticator.generateSecret();
  await User.updateOne({ _id: userId }, { $set: { twoFactorSecretEncrypted: encryptSecret(secret), twoFactorEnabled: false } });
  return { secret, otpauthUrl: authenticator.keyuri(user.email, 'CloudVault', secret) };
};

export const confirmTwoFactorSetup = async (userId: string, code: string): Promise<{ recoveryCodes: string[] }> => {
  const user = await User.findById(userId).select('+twoFactorSecretEncrypted');
  if (!user?.twoFactorSecretEncrypted || !authenticator.check(code, decryptSecret(user.twoFactorSecretEncrypted))) throw new AppError(400, 'AUTH_2FA_INVALID', 'The verification code is invalid.');
  const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(6).toString('hex'));
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map((value) => argon2.hash(value, passwordOptions)));
  await User.updateOne({ _id: userId }, { $set: { twoFactorEnabled: true, recoveryCodeHashes } });
  return { recoveryCodes };
};

export const disableTwoFactor = async (userId: string, password: string, code: string): Promise<void> => {
  const user = await User.findById(userId).select('+passwordHash +twoFactorSecretEncrypted');
  if (!user || !(await argon2.verify(user.passwordHash, password))) throw new AppError(401, 'AUTH_REAUTH_REQUIRED', 'Your password could not be verified.');
  if (!user.twoFactorSecretEncrypted || !authenticator.check(code, decryptSecret(user.twoFactorSecretEncrypted))) throw new AppError(400, 'AUTH_2FA_INVALID', 'The verification code is invalid.');
  await User.updateOne({ _id: userId }, { $set: { twoFactorEnabled: false, recoveryCodeHashes: [] }, $unset: { twoFactorSecretEncrypted: 1 } });
};

export const requestPasswordReset = async (email: string): Promise<string | undefined> => {
  const token = createOpaqueToken();
  await User.updateOne({ email }, { $set: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  return config.NODE_ENV === 'development' ? token : undefined;
};

export const resetPassword = async (token: string, password: string): Promise<void> => {
  const user = await User.findOneAndUpdate(
    { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: { $gt: new Date() } },
    { $set: { passwordHash: await argon2.hash(password, passwordOptions) }, $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } }
  );
  if (!user) throw new AppError(400, 'AUTH_RESET_INVALID', 'The password reset link is invalid or expired.');
  await revokeAllSessions(user.id, 'PASSWORD_RESET');
};

export const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<void> => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) throw new AppError(401, 'AUTH_REAUTH_REQUIRED', 'Your current password is incorrect.');
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await argon2.hash(newPassword, passwordOptions) } });
  await revokeAllSessions(userId, 'PASSWORD_CHANGED');
};
