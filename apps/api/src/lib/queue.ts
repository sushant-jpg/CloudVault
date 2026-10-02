import { Queue } from 'bullmq';
import { redis } from './redis';

export const fileQueue = new Queue('file-processing', { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 500, removeOnFail: 1_000 } });
export const maintenanceQueue = new Queue('maintenance', { connection: redis, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 1_000 } });
