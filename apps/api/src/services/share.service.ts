import argon2 from 'argon2';
import { getConfig } from '@cloudvault/config';
import { createOpaqueToken, sha256 } from '@cloudvault/security';
import type { CreateShareInput } from '@cloudvault/validation';
import { AppError } from '../lib/errors';
import { FileRecord, Notification, Share, ShareAccessEvent } from '../models';
import { authorizeFile } from './authorization.service';
import { storage } from './storage.service';

export interface ShareAccessContext {
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  requestId: string;
}

export const shareStatus = (share: { revokedAt?: Date | null; expiresAt: Date; oneTime: boolean; consumedAt?: Date | null; maxDownloads?: number | null; downloadCount: number }) => {
  if (share.revokedAt) return 'REVOKED';
  if (share.expiresAt <= new Date()) return 'EXPIRED';
  if ((share.oneTime && share.consumedAt) || (share.maxDownloads !== null && share.maxDownloads !== undefined && share.downloadCount >= share.maxDownloads)) return 'EXHAUSTED';
  return 'ACTIVE';
};

export const createShare = async (input: CreateShareInput, ownerId: string) => {
  const file = await authorizeFile(input.fileId, ownerId, 'FILE_SHARE');
  if (file.isDeleted) throw new AppError(409, 'FILE_DELETED', 'Deleted files cannot be shared.');
  if (file.securityStatus !== 'CLEAN') throw new AppError(409, file.securityStatus === 'BLOCKED' ? 'FILE_QUARANTINED' : 'FILE_SCAN_PENDING', 'The file is not available for sharing until security processing completes.');
  const token = createOpaqueToken(32);
  const share = await Share.create({
    tokenHash: sha256(token),
    fileId: file.id,
    ownerId,
    expiresAt: new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000),
    passwordHash: input.password ? await argon2.hash(input.password, { type: argon2.argon2id }) : undefined,
    maxDownloads: input.oneTime ? 1 : input.maxDownloads ?? null,
    recipientEmail: input.recipientEmail ?? undefined,
    requireAuthentication: input.requireAuthentication,
    oneTime: input.oneTime,
    allowDownload: input.allowDownload,
    note: input.note ?? undefined
  });
  return {
    share: share.toObject(),
    token,
    url: `${getConfig().WEB_URL}/s/${token}`
  };
};

const recordOutcome = async (shareId: string, fileId: string, context: ShareAccessContext, outcome: string): Promise<void> => {
  await ShareAccessEvent.create({ shareId, fileId, userId: context.userId, recipientEmail: context.email, outcome, ip: context.ip, userAgent: context.userAgent, requestId: context.requestId });
};

export const accessShare = async (token: string, password: string | undefined, intent: 'preview' | 'download', context: ShareAccessContext) => {
  const tokenHash = sha256(token);
  const share = await Share.findOne({ tokenHash }).select('+tokenHash +passwordHash');
  if (!share) throw new AppError(404, 'SHARE_NOT_FOUND', 'This secure share does not exist.');
  const currentStatus = shareStatus(share);
  if (currentStatus !== 'ACTIVE') {
    await recordOutcome(share.id, share.fileId.toString(), context, currentStatus);
    throw new AppError(410, `SHARE_${currentStatus}`, `This secure share is ${currentStatus.toLowerCase()}.`);
  }
  if (share.requireAuthentication && !context.userId) throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to access this secure share.');
  if (share.recipientEmail && context.email?.toLowerCase() !== share.recipientEmail.toLowerCase()) {
    await recordOutcome(share.id, share.fileId.toString(), context, 'RECIPIENT_MISMATCH');
    throw new AppError(403, 'SHARE_RECIPIENT_MISMATCH', 'This secure share is restricted to another verified account.');
  }
  if (share.passwordHash && (!password || !(await argon2.verify(share.passwordHash, password)))) {
    await recordOutcome(share.id, share.fileId.toString(), context, 'PASSWORD_FAILED');
    throw new AppError(401, 'SHARE_INVALID_PASSWORD', 'The share password is invalid.');
  }
  if (intent === 'download' && !share.allowDownload) throw new AppError(403, 'SHARE_DOWNLOAD_DISABLED', 'Downloads are disabled for this secure share.');

  const file = await FileRecord.findById(share.fileId).select('+storageKey');
  if (!file || file.isDeleted) throw new AppError(404, 'FILE_NOT_FOUND', 'The shared file is no longer available.');
  if (file.securityStatus !== 'CLEAN') throw new AppError(423, file.securityStatus === 'BLOCKED' ? 'FILE_QUARANTINED' : 'FILE_SCAN_PENDING', 'The shared file is unavailable while security processing is incomplete.');

  const atomicConditions: Record<string, unknown> = { _id: share.id, revokedAt: null, expiresAt: { $gt: new Date() } };
  if (share.oneTime) atomicConditions.consumedAt = null;
  if (intent === 'download' && share.maxDownloads !== null && share.maxDownloads !== undefined) atomicConditions.downloadCount = { $lt: share.maxDownloads };
  const update: Record<string, unknown> = { $inc: { accessCount: 1, ...(intent === 'download' ? { downloadCount: 1 } : {}) } };
  if (share.oneTime) update.$set = { consumedAt: new Date() };
  const consumed = await Share.findOneAndUpdate(atomicConditions, update, { new: true });
  if (!consumed) throw new AppError(410, 'SHARE_LIMIT_REACHED', 'This secure share has already been used or reached its download limit.');

  const disposition = `${intent === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.displayName)}`;
  const url = await storage.createTemporaryDownloadUrl(file.storageKey, getConfig().SIGNED_URL_TTL_SECONDS, {
    'response-content-type': file.mimeType,
    'response-content-disposition': disposition
  });
  await Promise.all([
    recordOutcome(share.id, file.id, context, 'SUCCESS'),
    Notification.create({ userId: share.ownerId, type: 'SHARE_ACCESSED', title: 'Secure share accessed', message: `${file.displayName} was accessed through a secure link.`, resourceType: 'share', resourceId: share.id })
  ]);
  return {
    url,
    expiresIn: getConfig().SIGNED_URL_TTL_SECONDS,
    shareId: share.id,
    file: { id: file.id, name: file.displayName, mimeType: file.mimeType, size: file.size },
    status: shareStatus(consumed)
  };
};

export const revokeShare = async (shareId: string, ownerId: string) => {
  const share = await Share.findOneAndUpdate({ _id: shareId, ownerId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedBy: ownerId } }, { new: true });
  if (!share) throw new AppError(404, 'SHARE_NOT_FOUND', 'The active secure share was not found.');
  return share;
};
