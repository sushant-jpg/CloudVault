import IORedis from 'ioredis';
import { getConfig } from '@cloudvault/config';

export const redis = new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true });

export const connectRedis = async (): Promise<void> => {
  if (redis.status === 'wait') await redis.connect();
};

export const redisReady = (): boolean => redis.status === 'ready';
