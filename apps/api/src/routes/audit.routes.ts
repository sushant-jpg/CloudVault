import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { AuditLog, OrganizationMember } from '../models';

export const auditRouter = Router();
auditRouter.use(authenticate);

auditRouter.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const memberships = await OrganizationMember.find({ userId: req.auth!.id, role: { $in: ['OWNER', 'ADMIN'] } }).distinct('organizationId');
  const resourceIds = memberships;
  const query = { $or: [{ actorId: req.auth!.id }, { resourceType: 'organization', resourceId: { $in: resourceIds } }] };
  const [events, total] = await Promise.all([
    AuditLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments(query)
  ]);
  res.json({ success: true, data: { events, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});
