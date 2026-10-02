import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { AuditLog, FileRecord, Folder, SecurityEvent, Share, User } from '../models';

export const userRouter = Router();
userRouter.use(authenticate);

userRouter.get('/dashboard', async (req, res) => {
  const activeShareQuery = { ownerId: req.auth!.id, revokedAt: null, expiresAt: { $gt: new Date() }, $expr: { $or: [{ $eq: ['$maxDownloads', null] }, { $lt: ['$downloadCount', '$maxDownloads'] }] } };
  const [user, files, folders, activeShares, alerts, recentActivity, recentFiles, recentDownloads] = await Promise.all([
    User.findById(req.auth!.id).select('name email storageUsedBytes storageQuotaBytes twoFactorEnabled emailVerified'),
    FileRecord.countDocuments({ ownerId: req.auth!.id, isDeleted: false }),
    Folder.countDocuments({ ownerId: req.auth!.id, deletedAt: null }),
    Share.countDocuments(activeShareQuery),
    SecurityEvent.countDocuments({ userId: req.auth!.id, status: { $in: ['OPEN', 'INVESTIGATING'] } }),
    AuditLog.find({ actorId: req.auth!.id }).sort({ createdAt: -1 }).limit(8),
    FileRecord.find({ ownerId: req.auth!.id, isDeleted: false }).sort({ createdAt: -1 }).limit(6),
    AuditLog.find({ actorId: req.auth!.id, action: 'FILE_DOWNLOADED' }).sort({ createdAt: -1 }).limit(5)
  ]);
  res.json({ success: true, data: { user, stats: { files, folders, activeShares, alerts }, recentActivity, recentFiles, recentDownloads } });
});
