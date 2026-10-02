import type { Server } from 'socket.io';
import { Notification } from '../models';

let io: Server | undefined;
export const bindNotificationServer = (server: Server): void => { io = server; };

export const createNotification = async (input: {
  userId: string;
  type: string;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
}): Promise<void> => {
  const notification = await Notification.create(input);
  io?.to(`user:${input.userId}`).emit('notification', notification.toObject());
};
