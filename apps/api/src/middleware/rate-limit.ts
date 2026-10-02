import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redis';

export const createRateLimit = (prefix: string, limit: number, windowMs: number) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: new RedisStore({
    prefix: `cloudvault:rate:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(args[0] ?? '', ...args.slice(1)) as Promise<number>
  }),
  handler: (req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', requestId: req.requestId } })
});

export const authRateLimit = createRateLimit('auth', 10, 15 * 60 * 1000);
export const sensitiveRateLimit = createRateLimit('sensitive', 5, 15 * 60 * 1000);
export const shareRateLimit = createRateLimit('share', 20, 10 * 60 * 1000);
export const uploadRateLimit = createRateLimit('upload', 30, 60 * 60 * 1000);
