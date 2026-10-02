import { Router } from 'express';
import { scoreRisk } from '@cloudvault/security';
import { authenticate } from '../middleware/auth';
import { AuditLog, SecurityEvent, Session, User } from '../models';

export const securityRouter = Router();
securityRouter.use(authenticate);

securityRouter.get('/overview', async (req, res) => {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [user, sessions, events, failedLogins, downloads] = await Promise.all([
    User.findById(req.auth!.id),
    Session.find({ userId: req.auth!.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastActivityAt: -1 }),
    SecurityEvent.find({ userId: req.auth!.id }).sort({ createdAt: -1 }).limit(50),
    SecurityEvent.countDocuments({ userId: req.auth!.id, type: 'MULTIPLE_LOGIN_FAILURES', createdAt: { $gte: since } }),
    AuditLog.countDocuments({ actorId: req.auth!.id, action: 'FILE_DOWNLOADED', createdAt: { $gte: since } })
  ]);
  const risk = scoreRisk({ loginFailures: failedLogins * 5, downloadsLastHour: downloads });
  const setupScore = (user?.emailVerified ? 35 : 0) + (user?.twoFactorEnabled ? 40 : 0) + (sessions.length <= 3 ? 25 : 10);
  res.json({ success: true, data: { setupScore, twoFactorEnabled: user?.twoFactorEnabled ?? false, sessions, events, risk } });
});

securityRouter.get('/events', async (req, res) => {
  const events = await SecurityEvent.find({ userId: req.auth!.id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: { events } });
});

securityRouter.patch('/events/:id', async (req, res) => {
  const allowed = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'];
  if (!allowed.includes(req.body.status)) return res.status(422).json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'A valid status is required.', requestId: req.requestId } });
  const event = await SecurityEvent.findOneAndUpdate({ _id: req.params.id, userId: req.auth!.id }, { $set: { status: req.body.status } }, { new: true });
  res.json({ success: true, data: { event } });
});
