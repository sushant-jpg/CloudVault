import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { Notification } from '../models';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const query = { userId: req.auth!.id };
  const [notifications, total, unread] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(query),
    Notification.countDocuments({ ...query, readAt: null })
  ]);
  res.json({ success: true, data: { notifications, unread, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

notificationRouter.post('/read-all', async (req, res) => {
  const result = await Notification.updateMany({ userId: req.auth!.id, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ success: true, data: { updated: result.modifiedCount } });
});

notificationRouter.post('/:id/read', async (req, res) => {
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.auth!.id }, { $set: { readAt: new Date() } }, { new: true });
  res.json({ success: true, data: { notification } });
});
