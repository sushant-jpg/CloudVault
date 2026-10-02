import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { getConfig } from '@cloudvault/config';
import { createApp } from './app';
import { connectDatabase } from './lib/database';
import { logger } from './lib/logger';
import { connectRedis } from './lib/redis';
import { verifyAccessToken } from './services/auth.service';
import { bindNotificationServer } from './services/notification.service';
import { storage } from './services/storage.service';

const config = getConfig();
await Promise.all([connectDatabase(), connectRedis(), storage.ensureBucket()]);

const httpServer = createServer(createApp());
const io = new Server(httpServer, { cors: { origin: config.WEB_URL, credentials: true } });
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string') throw new Error('Missing token');
    socket.data.user = await verifyAccessToken(token);
    next();
  } catch { next(new Error('Authentication required')); }
});
io.on('connection', (socket) => { socket.join(`user:${socket.data.user.id}`); });
bindNotificationServer(io);

httpServer.listen(config.PORT, () => logger.info({ port: config.PORT }, 'CloudVault API listening'));

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Graceful shutdown started');
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
