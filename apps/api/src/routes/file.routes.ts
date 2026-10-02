import { Router } from 'express';
import multer from 'multer';
import { getConfig } from '@cloudvault/config';
import { authenticate, requirePermission } from '../middleware/auth';
import { uploadRateLimit } from '../middleware/rate-limit';
import { AppError } from '../lib/errors';
import { FileRecord, FileVersion, OrganizationMember, User } from '../models';
import { writeAudit } from '../services/audit.service';
import { authorizeFile, authorizeFolder } from '../services/authorization.service';
import { restoreFileVersion, updateFileDetails, uploadFile, uploadFileVersion, verifyIntegrity } from '../services/file.service';
import { storage } from '../services/storage.service';

export const fileRouter = Router();
const config = getConfig();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_FILE_SIZE_BYTES, files: 1, fields: 10 } });
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

fileRouter.use(authenticate);

fileRouter.get('/', requirePermission('FILE_READ'), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const memberships = await OrganizationMember.find({ userId: req.auth!.id }).distinct('organizationId');
  const accessScope = { $or: [{ ownerId: req.auth!.id }, { workspaceId: { $in: memberships } }] };
  const query: Record<string, unknown> = { ...accessScope, isDeleted: req.query.trashed === 'true' };
  if (typeof req.query.folderId === 'string') query.folderId = req.query.folderId === 'root' ? null : req.query.folderId;
  if (typeof req.query.search === 'string' && req.query.search.trim()) query.displayName = { $regex: escapeRegex(req.query.search.trim()), $options: 'i' };
  if (typeof req.query.mimeType === 'string') query.mimeType = req.query.mimeType;
  const [files, total] = await Promise.all([
    FileRecord.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    FileRecord.countDocuments(query)
  ]);
  res.json({ success: true, data: { files, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

fileRouter.post('/upload', requirePermission('FILE_CREATE'), uploadRateLimit, upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(422, 'FILE_REQUIRED', 'Choose a file to upload.');
  const folderId = typeof req.body.folderId === 'string' && req.body.folderId ? req.body.folderId : undefined;
  const workspaceId = typeof req.body.workspaceId === 'string' && req.body.workspaceId ? req.body.workspaceId : undefined;
  if (folderId) {
    const folder = await authorizeFolder(folderId, req.auth!.id, 'FILE_CREATE');
    if ((folder.workspaceId?.toString() ?? undefined) !== workspaceId) throw new AppError(409, 'FILE_FOLDER_MISMATCH', 'The folder does not belong to the selected workspace.');
  }
  const file = await uploadFile(req.file, req.auth!.id, folderId, workspaceId);
  await writeAudit(req, 'FILE_UPLOADED', 'file', file._id.toString(), { size: file.size, mimeType: file.mimeType });
  res.status(201).json({ success: true, data: { file } });
});

fileRouter.get('/:id', requirePermission('FILE_READ'), async (req, res) => {
  const fileId = String(req.params.id);
  const file = await authorizeFile(fileId, req.auth!.id, 'FILE_READ');
  res.json({ success: true, data: { file } });
});

fileRouter.patch('/:id', requirePermission('FILE_UPDATE'), async (req, res) => {
  const fileId = String(req.params.id);
  await authorizeFile(fileId, req.auth!.id, 'FILE_UPDATE');
  const displayName = req.body.displayName;
  const folderId = req.body.folderId;
  if (displayName === undefined && folderId === undefined) throw new AppError(422, 'VALIDATION_FAILED', 'Provide a new display name or destination folder.');
  if (displayName !== undefined && typeof displayName !== 'string') throw new AppError(422, 'VALIDATION_FAILED', 'A valid display name is required.');
  if (folderId !== undefined && folderId !== null && typeof folderId !== 'string') throw new AppError(422, 'VALIDATION_FAILED', 'A valid destination folder is required.');
  const file = await updateFileDetails(fileId, req.auth!.id, { displayName, folderId });
  if (displayName !== undefined) await writeAudit(req, 'FILE_RENAMED', 'file', fileId, { displayName: file.displayName });
  if (folderId !== undefined) await writeAudit(req, 'FILE_MOVED', 'file', fileId, { folderId: folderId ?? null });
  res.json({ success: true, data: { file } });
});

fileRouter.post('/:id/download', requirePermission('FILE_DOWNLOAD'), async (req, res) => {
  const fileId = String(req.params.id);
  const file = await authorizeFile(fileId, req.auth!.id, 'FILE_DOWNLOAD');
  if (file.isDeleted) throw new AppError(410, 'FILE_DELETED', 'Restore this file before downloading it.');
  if (file.securityStatus !== 'CLEAN') throw new AppError(423, file.securityStatus === 'BLOCKED' ? 'FILE_QUARANTINED' : 'FILE_SCAN_PENDING', 'This file is unavailable until security processing completes.');
  const url = await storage.createTemporaryDownloadUrl(file.storageKey, config.SIGNED_URL_TTL_SECONDS, {
    'response-content-type': file.mimeType,
    'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.displayName)}`
  });
  await writeAudit(req, 'FILE_DOWNLOADED', 'file', file.id);
  res.json({ success: true, data: { url, expiresIn: config.SIGNED_URL_TTL_SECONDS } });
});

fileRouter.get('/:id/content', requirePermission('FILE_DOWNLOAD'), async (req, res) => {
  const fileId = String(req.params.id);
  const file = await authorizeFile(fileId, req.auth!.id, 'FILE_DOWNLOAD');
  if (file.isDeleted) throw new AppError(410, 'FILE_DELETED', 'Restore this file before downloading it.');
  if (file.securityStatus !== 'CLEAN') throw new AppError(423, file.securityStatus === 'BLOCKED' ? 'FILE_QUARANTINED' : 'FILE_SCAN_PENDING', 'This file is unavailable until security processing completes.');
  await writeAudit(req, 'FILE_DOWNLOADED', 'file', file.id);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.displayName)}`);
  const stream = await storage.download(file.storageKey);
  stream.on('error', (error) => {
    if (!res.headersSent) res.status(500);
    res.destroy(error);
  });
  stream.pipe(res);
});

fileRouter.post('/:id/integrity', requirePermission('FILE_READ'), async (req, res) => {
  const fileId = String(req.params.id);
  const file = await authorizeFile(fileId, req.auth!.id, 'FILE_READ');
  const result = await verifyIntegrity(file.storageKey, file.sha256);
  res.json({ success: true, data: result });
});

fileRouter.delete('/:id', requirePermission('FILE_DELETE'), async (req, res) => {
  const fileId = String(req.params.id);
  const file = await authorizeFile(fileId, req.auth!.id, 'FILE_DELETE');
  if (!file.isDeleted) {
    file.isDeleted = true;
    file.deletedAt = new Date();
    file.deletedBy = req.auth!.id as never;
    await file.save();
    await writeAudit(req, 'FILE_DELETED', 'file', file.id);
  }
  res.status(204).send();
});

fileRouter.post('/:id/restore', requirePermission('FILE_RESTORE'), async (req, res) => {
  const fileId = String(req.params.id);
  const file = await authorizeFile(fileId, req.auth!.id, 'FILE_RESTORE');
  file.isDeleted = false;
  file.deletedAt = undefined;
  file.deletedBy = undefined;
  await file.save();
  await writeAudit(req, 'FILE_RESTORED', 'file', file.id);
  res.json({ success: true, data: { file } });
});

fileRouter.get('/:id/versions', requirePermission('FILE_READ'), async (req, res) => {
  const fileId = String(req.params.id);
  await authorizeFile(fileId, req.auth!.id, 'FILE_READ');
  const versions = await FileVersion.find({ fileId }).sort({ version: -1 });
  res.json({ success: true, data: { versions } });
});

fileRouter.get('/:id/versions/:version/content', requirePermission('FILE_DOWNLOAD'), async (req, res) => {
  const fileId = String(req.params.id);
  await authorizeFile(fileId, req.auth!.id, 'FILE_DOWNLOAD');
  const versionNumber = Number(req.params.version);
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new AppError(422, 'FILE_VERSION_INVALID', 'A valid file version is required.');
  const version = await FileVersion.findOne({ fileId, version: versionNumber }).select('+storageKey');
  if (!version) throw new AppError(404, 'FILE_VERSION_NOT_FOUND', 'The requested file version was not found.');
  if (version.securityStatus !== 'CLEAN') throw new AppError(423, version.securityStatus === 'BLOCKED' ? 'FILE_QUARANTINED' : 'FILE_SCAN_PENDING', 'This version is unavailable until security processing completes.');
  await writeAudit(req, 'FILE_DOWNLOADED', 'file', fileId, { version: versionNumber });
  res.setHeader('Content-Type', version.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="file-version-${versionNumber}"`);
  const stream = await storage.download(version.storageKey);
  stream.on('error', (error) => {
    if (!res.headersSent) res.status(500);
    res.destroy(error);
  });
  stream.pipe(res);
});

fileRouter.post('/:id/versions', requirePermission('FILE_UPDATE'), uploadRateLimit, upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(422, 'FILE_REQUIRED', 'Choose a file to upload.');
  const fileId = String(req.params.id);
  await authorizeFile(fileId, req.auth!.id, 'FILE_UPDATE');
  const file = await uploadFileVersion(fileId, req.file, req.auth!.id);
  await writeAudit(req, 'FILE_VERSION_CREATED', 'file', fileId, { version: file?.currentVersion });
  res.status(201).json({ success: true, data: { file } });
});

fileRouter.post('/:id/versions/:version/restore', requirePermission('FILE_UPDATE'), async (req, res) => {
  const fileId = String(req.params.id);
  await authorizeFile(fileId, req.auth!.id, 'FILE_UPDATE');
  const versionNumber = Number(req.params.version);
  const file = await restoreFileVersion(fileId, versionNumber, req.auth!.id);
  await writeAudit(req, 'FILE_VERSION_CREATED', 'file', fileId, { restoredFrom: versionNumber, version: file?.currentVersion });
  res.json({ success: true, data: { file } });
});

fileRouter.get('/usage/summary', async (req, res) => {
  const user = await User.findById(req.auth!.id).select('storageUsedBytes storageQuotaBytes');
  res.json({ success: true, data: { storageUsedBytes: user?.storageUsedBytes ?? 0, storageQuotaBytes: user?.storageQuotaBytes ?? 0 } });
});
