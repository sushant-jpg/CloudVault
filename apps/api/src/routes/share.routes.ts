import { Router } from 'express';
import { createShareSchema, shareAccessSchema } from '@cloudvault/validation';
import { authenticate, optionalAuthenticate, requirePermission } from '../middleware/auth';
import { shareRateLimit } from '../middleware/rate-limit';
import { validateBody } from '../middleware/validate';
import { FileRecord, Share, ShareAccessEvent } from '../models';
import { writeAudit, writeSecurityEvent } from '../services/audit.service';
import { accessShare, createShare, revokeShare, shareStatus } from '../services/share.service';
import { storage } from '../services/storage.service';

export const shareRouter = Router();

shareRouter.post('/:token/access', shareRateLimit, optionalAuthenticate, validateBody(shareAccessSchema), async (req, res) => {
  try {
    const token = String(req.params.token);
    const result = await accessShare(token, req.body.password, req.body.intent, {
      userId: req.auth?.id,
      email: req.auth?.email,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.requestId
    });
    await writeAudit(req, 'SHARE_ACCESSED', 'share', undefined, { intent: req.body.intent });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SHARE_INVALID_PASSWORD') {
      await writeSecurityEvent(req, 'SHARE_BRUTE_FORCE', 'MEDIUM', 'share', undefined, { outcome: 'password_failed' });
    }
    throw error;
  }
});

shareRouter.post('/:token/content', shareRateLimit, optionalAuthenticate, validateBody(shareAccessSchema), async (req, res) => {
  try {
    const result = await accessShare(String(req.params.token), req.body.password, req.body.intent, {
      userId: req.auth?.id,
      email: req.auth?.email,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.requestId
    });
    await writeAudit(req, 'SHARE_ACCESSED', 'share', result.shareId, { intent: req.body.intent });
    if (req.body.intent === 'download') await writeAudit(req, 'FILE_DOWNLOADED', 'file', result.file.id, { viaShare: true });
    const file = await FileRecord.findById(result.file.id).select('+storageKey');
    if (!file) throw new Error('The shared file disappeared after access was consumed.');
    res.setHeader('Content-Type', result.file.mimeType);
    res.setHeader('Content-Disposition', `${req.body.intent === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(result.file.name)}`);
    const stream = await storage.download(file.storageKey);
    stream.on('error', (error) => {
      if (!res.headersSent) res.status(500);
      res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SHARE_INVALID_PASSWORD') {
      await writeSecurityEvent(req, 'SHARE_BRUTE_FORCE', 'MEDIUM', 'share', undefined, { outcome: 'password_failed' });
    }
    throw error;
  }
});

shareRouter.use(authenticate);

shareRouter.get('/', requirePermission('FILE_READ'), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [shares, total] = await Promise.all([
    Share.find({ ownerId: req.auth!.id }).populate('fileId', 'displayName mimeType size').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Share.countDocuments({ ownerId: req.auth!.id })
  ]);
  res.json({ success: true, data: { shares: shares.map((share) => ({ ...share.toObject(), status: shareStatus(share) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

shareRouter.post('/', requirePermission('FILE_SHARE'), validateBody(createShareSchema), async (req, res) => {
  const result = await createShare(req.body, req.auth!.id);
  await writeAudit(req, 'SHARE_CREATED', 'share', result.share._id.toString(), { expiresAt: result.share.expiresAt, maxDownloads: result.share.maxDownloads, passwordProtected: Boolean(result.share.passwordHash) });
  res.status(201).json({ success: true, data: result });
});

shareRouter.post('/:id/revoke', requirePermission('FILE_SHARE'), async (req, res) => {
  const shareId = String(req.params.id);
  const share = await revokeShare(shareId, req.auth!.id);
  await writeAudit(req, 'SHARE_REVOKED', 'share', share.id);
  res.json({ success: true, data: { share: { ...share.toObject(), status: 'REVOKED' } } });
});

shareRouter.get('/:id/activity', requirePermission('FILE_SHARE'), async (req, res) => {
  const shareId = String(req.params.id);
  const share = await Share.findOne({ _id: shareId, ownerId: req.auth!.id });
  if (!share) return res.status(404).json({ success: false, error: { code: 'SHARE_NOT_FOUND', message: 'The secure share was not found.', requestId: req.requestId } });
  const events = await ShareAccessEvent.find({ shareId: share.id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: { events } });
});
