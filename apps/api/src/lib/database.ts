import mongoose from 'mongoose';
import { getConfig } from '@cloudvault/config';
import { logger } from './logger';

export const connectDatabase = async (): Promise<void> => {
  await mongoose.connect(getConfig().MONGODB_URI, { autoIndex: getConfig().NODE_ENV !== 'production' });
  logger.info('MongoDB connected');
};

export const databaseReady = (): boolean => mongoose.connection.readyState === 1;
