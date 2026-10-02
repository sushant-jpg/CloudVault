import { Queue, Worker } from 'bullmq';
import { createServer } from 'node:http';
import IORedis from 'ioredis';
import { Client } from 'minio';
import mongoose from 'mongoose';
import pino from 'pino';
import { getConfig } from '@cloudvault/config';
import { AuditLog, FileRecord, FileVersion, Notification, Organization, SecurityEvent, Share, User } from './models';
import { ClamAvScanner } from './scanner';

const config = getConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'cloudvault-worker' } });
const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const minio = new Client({ endPoint: config.MINIO_ENDPOINT, port: config.MINIO_PORT, useSSL: config.MINIO_USE_SSL, accessKey: config.MINIO_ACCESS_KEY, secretKey: config.MINIO_SECRET_KEY });
const scanner = new ClamAvScanner();

await mongoose.connect(config.MONGODB_URI);
const fileWorker = new Worker('file-processing', async (job) => {
  if (job.name !== 'malware-scan') return;
  const { fileId, storageKey, ownerId, version = 1 } = job.data as { fileId: string; storageKey: string; ownerId: string; version?: number };
  const versionRecord = await FileVersion.findOneAndUpdate(
    { fileId, version, securityStatus: { $in: ['SCAN_PENDING', 'SCAN_FAILED'] } },
    { $set: { securityStatus: 'SCANNING' } },
    { new: true }
  );
  if (!versionRecord) return;
  const currentFile = await FileRecord.findOneAndUpdate(
    { _id: fileId, currentVersion: version, securityStatus: { $in: ['SCAN_PENDING', 'SCAN_FAILED'] } },
    { $set: { securityStatus: 'SCANNING' } },
    { new: true }
  );
  try {
    const stream = await minio.getObject(config.MINIO_BUCKET, storageKey);
    const result = await scanner.scan(stream);
    const status = result.clean ? 'CLEAN' : 'BLOCKED';
    await FileVersion.updateOne({ fileId, version }, { $set: { securityStatus: status } });
    if (currentFile) await FileRecord.updateOne(
      { _id: fileId, currentVersion: version },
      { $set: { securityStatus: status, securityMessage: result.clean ? 'Scanned by ClamAV; no known malware detected.' : `Blocked by malware scanner: ${result.signature ?? 'unknown signature'}` } }
    );
    await Notification.create({ userId: ownerId, type: result.clean ? 'FILE_PROCESSING_COMPLETED' : 'MALWARE_BLOCKED', title: result.clean ? 'File ready' : 'Malware blocked', message: result.clean ? `Version ${version} passed security processing.` : `Version ${version} was quarantined after malware was detected.`, resourceType: 'file', resourceId: fileId });
    if (!result.clean) await SecurityEvent.create({ type: 'MALWARE_DETECTED', severity: 'CRITICAL', userId: ownerId, resourceType: 'file', resourceId: fileId, status: 'OPEN', metadata: { signature: result.signature } });
  } catch (error) {
    await FileVersion.updateOne({ fileId, version }, { $set: { securityStatus: 'SCAN_FAILED' } });
    if (currentFile) await FileRecord.updateOne(
      { _id: fileId, currentVersion: version },
      { $set: { securityStatus: 'SCAN_FAILED', securityMessage: 'Malware scanning could not be completed.' } }
    );
    throw error;
  }
}, { connection, concurrency: 4, lockDuration: 120_000 });

const maintenanceWorker = new Worker('maintenance', async (job) => {
  if (job.name === 'expire-shares') {
    const expired = await Share.find({ expiresAt: { $lte: new Date() }, revokedAt: null, expiredNotificationSentAt: null }).limit(500);
    for (const share of expired) {
      const claimed = await Share.findOneAndUpdate(
        { _id: share.id, expiredNotificationSentAt: null },
        { $set: { expiredNotificationSentAt: new Date() } },
        { new: true }
      );
      if (!claimed) continue;
      await Notification.create({ userId: share.ownerId, type: 'SHARE_EXPIRED', title: 'Secure share expired', message: 'A secure share reached its expiration time.', resourceType: 'share', resourceId: share.id });
      await AuditLog.create({ actorId: share.ownerId, action: 'SHARE_EXPIRED', resourceType: 'share', resourceId: share.id, requestId: `worker:${job.id}`, metadata: {} });
    }
    return { processed: expired.length };
  }
  if (job.name === 'trash-cleanup') {
    const cutoff = new Date(Date.now() - config.TRASH_RETENTION_DAYS * 86_400_000);
    const files = await FileRecord.find({ isDeleted: true, deletedAt: { $lte: cutoff } }).select('+storageKey').limit(100);
    for (const file of files) {
      const versions = await FileVersion.find({ fileId: file.id }).select('+storageKey');
      const keys = new Set([file.storageKey, ...versions.map((version) => version.storageKey).filter((key): key is string => Boolean(key))]);
      for (const key of keys) await minio.removeObject(config.MINIO_BUCKET, key);
      const totalBytes = versions.reduce((sum: number, version) => sum + (version.size ?? 0), 0) || file.size || 0;
      if (file.workspaceId) await Organization.updateOne({ _id: file.workspaceId }, { $inc: { storageUsedBytes: -totalBytes } });
      else await User.updateOne({ _id: file.ownerId }, { $inc: { storageUsedBytes: -totalBytes } });
      await FileVersion.deleteMany({ fileId: file.id });
      await FileRecord.deleteOne({ _id: file.id });
    }
    return { deleted: files.length };
  }
  if (job.name === 'share-expiry-warning') {
    const start = new Date(Date.now() + 55 * 60 * 1000);
    const end = new Date(Date.now() + 65 * 60 * 1000);
    const shares = await Share.find({ expiresAt: { $gte: start, $lte: end }, revokedAt: null }).limit(500);
    for (const share of shares) await Notification.create({ userId: share.ownerId, type: 'SHARE_NEARING_EXPIRATION', title: 'Secure share expiring soon', message: 'A secure share expires in about one hour.', resourceType: 'share', resourceId: share.id });
    return { notified: shares.length };
  }
}, { connection, concurrency: 2 });

fileWorker.on('completed', (job) => logger.info({ jobId: job.id, name: job.name }, 'Job completed'));
fileWorker.on('failed', (job, error) => logger.error({ jobId: job?.id, err: error }, 'Job failed'));
maintenanceWorker.on('failed', (job, error) => logger.error({ jobId: job?.id, err: error }, 'Maintenance job failed'));

const maintenance = new Queue('maintenance', { connection });
await maintenance.add('expire-shares', {}, { jobId: 'scheduled-expire-shares', repeat: { every: 5 * 60_000 }, removeOnComplete: 10, removeOnFail: 100 });
await maintenance.add('trash-cleanup', {}, { jobId: 'scheduled-trash-cleanup', repeat: { every: 60 * 60_000 }, removeOnComplete: 10, removeOnFail: 100 });
await maintenance.add('share-expiry-warning', {}, { jobId: 'scheduled-share-warning', repeat: { every: 10 * 60_000 }, removeOnComplete: 10, removeOnFail: 100 });

const readinessServer = createServer((_request, response) => {
  const ready = mongoose.connection.readyState === 1 && connection.status === 'ready';
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: ready ? 'ok' : 'unavailable', service: 'cloudvault-worker' }));
});
await Promise.all([fileWorker.waitUntilReady(), maintenanceWorker.waitUntilReady(), connection.ping()]);
readinessServer.listen(4001, '0.0.0.0');
logger.info('CloudVault worker ready');

const shutdown = async () => {
  readinessServer.close();
  await Promise.all([fileWorker.close(), maintenanceWorker.close(), maintenance.close()]);
  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
