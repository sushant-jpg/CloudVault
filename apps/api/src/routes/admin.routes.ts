import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { AuditLog, FileRecord, SecurityEvent, Session, Share, User } from '../models';
import { databaseReady } from '../lib/database';
import { redisReady } from '../lib/redis';
import { storage } from '../services/storage.service';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('SYSTEM_ADMIN'));

adminRouter.get('/overview', async (_req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const storageUsageResult = await User.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$storageUsedBytes' } } }]);
  const [totalUsers, activeUsers, totalFiles, activeShares, malwareDetections, securityEvents, failedLogins, recentAudit, storageReady] = await Promise.all([
    User.countDocuments(),
    Session.distinct('userId', { lastActivityAt: { $gte: since }, revokedAt: null }).then((ids) => ids.length),
    FileRecord.countDocuments({ isDeleted: false }),
    Share.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
    SecurityEvent.countDocuments({ type: 'MALWARE_DETECTED' }),
    SecurityEvent.countDocuments({ status: { $in: ['OPEN', 'INVESTIGATING'] } }),
    AuditLog.countDocuments({ action: 'LOGIN_FAILED', createdAt: { $gte: since } }),
    AuditLog.find().sort({ createdAt: -1 }).limit(20),
    storage.ready()
  ]);
  res.json({ success: true, data: { metrics: { totalUsers, activeUsers, storageUsedBytes: storageUsageResult[0]?.total ?? 0, totalFiles, activeShares, malwareDetections, securityEvents, failedLogins }, health: { mongodb: databaseReady(), redis: redisReady(), objectStorage: storageReady }, recentAudit, policy: 'System administrators can inspect metadata and security state but are not automatically authorized to access private file contents.' } });
});
