import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { getConfig } from '@cloudvault/config';
import { workspaceHasPermission } from '@cloudvault/security';
import type { WorkspaceRole } from '@cloudvault/types';
import { AppError } from '../lib/errors';
import { FileRecord, FileVersion, Folder, Organization, OrganizationMember, User } from '../models';
import { fileQueue } from '../lib/queue';
import { storage } from './storage.service';

const config = getConfig();
const allowedExtensions: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'text/plain': ['.txt', '.md', '.csv']
};

const sanitizeName = (name: string): string => {
  const normalized = path.basename(name).normalize('NFKC');
  const cleaned = Array.from(normalized).filter((char) => {
    const code = char.charCodeAt(0);
    return code > 31 && code !== 127;
  }).join('');
  const base = cleaned.replace(/[<>:"/\\|?*]/g, '_').trim();
  if (!base || base === '.' || base === '..') throw new AppError(422, 'FILE_INVALID_NAME', 'The filename is invalid.');
  return base.slice(0, 180);
};

export const inspectUpload = async (file: Express.Multer.File): Promise<{ displayName: string; mimeType: string; hash: string }> => {
  if (!file.buffer.length) throw new AppError(422, 'FILE_EMPTY', 'Empty files cannot be uploaded.');
  if (file.buffer.length > config.MAX_FILE_SIZE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file exceeds the configured upload limit.');
  const displayName = sanitizeName(file.originalname);
  const extension = path.extname(displayName).toLowerCase();
  const nestedExtension = path.extname(path.basename(displayName, extension)).toLowerCase();
  if (['.exe', '.js', '.html', '.htm', '.svg', '.bat', '.cmd', '.ps1', '.scr'].includes(extension) || ['.exe', '.js', '.html', '.bat', '.cmd'].includes(nestedExtension)) {
    throw new AppError(422, 'FILE_TYPE_BLOCKED', 'This file type is not permitted.');
  }
  const detected = await fileTypeFromBuffer(file.buffer);
  let mimeType = detected?.mime;
  if (!mimeType && allowedExtensions['text/plain']?.includes(extension)) {
    if (file.buffer.includes(0)) throw new AppError(422, 'FILE_CONTENT_INVALID', 'The file content does not match a supported text format.');
    mimeType = 'text/plain';
  }
  if (!mimeType || !config.allowedMimeTypes.includes(mimeType)) throw new AppError(422, 'FILE_TYPE_UNSUPPORTED', 'The file content type is not supported.');
  if (!allowedExtensions[mimeType]?.includes(extension)) throw new AppError(422, 'FILE_EXTENSION_MISMATCH', 'The filename extension does not match the file content.');
  return { displayName, mimeType, hash: createHash('sha256').update(file.buffer).digest('hex') };
};

const reserveQuota = async (
  userId: string,
  workspaceId: string | undefined,
  bytes: number,
  permission: 'FILE_CREATE' | 'FILE_UPDATE' = 'FILE_CREATE'
): Promise<void> => {
  if (workspaceId) {
    const member = await OrganizationMember.findOne({ organizationId: workspaceId, userId });
    if (!member || !workspaceHasPermission(member.role as WorkspaceRole, permission)) {
      throw new AppError(403, 'FILE_ACCESS_DENIED', 'You do not have permission to store files in this workspace.');
    }
    const organization = await Organization.findOneAndUpdate(
      { _id: workspaceId, $expr: { $lte: [{ $add: ['$storageUsedBytes', bytes] }, '$storageQuotaBytes'] } },
      { $inc: { storageUsedBytes: bytes } }
    );
    if (!organization) throw new AppError(413, 'STORAGE_QUOTA_EXCEEDED', 'The workspace storage quota has been exceeded.');
    return;
  }
  const user = await User.findOneAndUpdate(
    { _id: userId, $expr: { $lte: [{ $add: ['$storageUsedBytes', bytes] }, '$storageQuotaBytes'] } },
    { $inc: { storageUsedBytes: bytes } }
  );
  if (!user) throw new AppError(413, 'STORAGE_QUOTA_EXCEEDED', 'Your storage quota has been exceeded.');
};

const releaseQuota = async (userId: string, workspaceId: string | undefined, bytes: number): Promise<void> => {
  if (workspaceId) await Organization.updateOne({ _id: workspaceId }, { $inc: { storageUsedBytes: -bytes } });
  else await User.updateOne({ _id: userId }, { $inc: { storageUsedBytes: -bytes } });
};

export const uploadFile = async (file: Express.Multer.File, userId: string, folderId?: string, workspaceId?: string) => {
  const inspected = await inspectUpload(file);
  await reserveQuota(userId, workspaceId, file.size);
  const storageKey = `${workspaceId ? `workspaces/${workspaceId}` : `users/${userId}`}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  try {
    await storage.upload(storageKey, file.buffer, { 'content-type': inspected.mimeType, 'x-amz-meta-sha256': inspected.hash });
    const record = await FileRecord.create({
      ownerId: userId,
      workspaceId: workspaceId ?? null,
      folderId: folderId ?? null,
      originalFilename: file.originalname,
      displayName: inspected.displayName,
      storageKey,
      mimeType: inspected.mimeType,
      size: file.size,
      sha256: inspected.hash,
      securityStatus: 'UPLOAD_RECEIVED'
    });
    await FileVersion.create({ fileId: record.id, version: 1, size: file.size, sha256: inspected.hash, storageKey, mimeType: inspected.mimeType, securityStatus: 'UPLOAD_RECEIVED', uploadedBy: userId });
    await FileRecord.updateOne({ _id: record.id }, { $set: { securityStatus: 'QUARANTINED' } });
    await FileVersion.updateOne({ fileId: record.id, version: 1 }, { $set: { securityStatus: 'QUARANTINED' } });
    if (config.REQUIRE_MALWARE_SCAN) {
      await FileRecord.updateOne({ _id: record.id }, { $set: { securityStatus: 'SCAN_PENDING' } });
      await FileVersion.updateOne({ fileId: record.id, version: 1 }, { $set: { securityStatus: 'SCAN_PENDING' } });
      await fileQueue.add('malware-scan', { fileId: record.id, storageKey, ownerId: userId, version: 1 }, { jobId: `scan-${record.id}-v1` });
    } else {
      await FileRecord.updateOne({ _id: record.id }, { $set: { securityStatus: 'SCAN_FAILED', securityMessage: 'Malware scanning is disabled; this file is unavailable.' } });
      await FileVersion.updateOne({ fileId: record.id, version: 1 }, { $set: { securityStatus: 'SCAN_FAILED' } });
    }
    const [savedRecord, duplicateDetected] = await Promise.all([
      FileRecord.findById(record.id),
      FileRecord.exists({ _id: { $ne: record.id }, ownerId: userId, sha256: inspected.hash, isDeleted: false })
    ]);
    if (!savedRecord) throw new Error('The uploaded file record could not be read after persistence.');
    return { ...savedRecord.toObject(), duplicateDetected: Boolean(duplicateDetected) };
  } catch (error) {
    await releaseQuota(userId, workspaceId, file.size);
    try { await storage.delete(storageKey); } catch { /* best effort rollback */ }
    throw error;
  }
};

export const verifyIntegrity = async (storageKey: string, expectedHash: string): Promise<{ verified: boolean; actualHash: string }> => {
  const stream = await storage.download(storageKey);
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk as Buffer);
  const actualHash = hash.digest('hex');
  return { verified: actualHash === expectedHash, actualHash };
};

export const uploadFileVersion = async (fileId: string, upload: Express.Multer.File, userId: string) => {
  const file = await FileRecord.findById(fileId).select('+storageKey');
  if (!file || file.ownerId.toString() !== userId) throw new AppError(404, 'FILE_NOT_FOUND', 'The requested file was not found.');
  if (file.isDeleted) throw new AppError(409, 'FILE_DELETED', 'Restore this file before adding a version.');
  const inspected = await inspectUpload(upload);
  const workspaceId = file.workspaceId?.toString();
  await reserveQuota(userId, workspaceId, upload.size, 'FILE_UPDATE');
  const version = file.currentVersion + 1;
  const storageKey = `${workspaceId ? `workspaces/${workspaceId}` : `users/${userId}`}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  try {
    await storage.upload(storageKey, upload.buffer, { 'content-type': inspected.mimeType, 'x-amz-meta-sha256': inspected.hash });
    await FileVersion.create({ fileId, version, size: upload.size, sha256: inspected.hash, storageKey, mimeType: inspected.mimeType, securityStatus: 'QUARANTINED', uploadedBy: userId });
    const securityStatus = config.REQUIRE_MALWARE_SCAN ? 'SCAN_PENDING' : 'SCAN_FAILED';
    await FileVersion.updateOne({ fileId, version }, { $set: { securityStatus } });
    await FileRecord.updateOne({ _id: fileId, currentVersion: file.currentVersion }, { $set: {
      currentVersion: version,
      storageKey,
      size: upload.size,
      sha256: inspected.hash,
      mimeType: inspected.mimeType,
      securityStatus,
      ...(config.REQUIRE_MALWARE_SCAN ? {} : { securityMessage: 'Malware scanning is disabled; this file is unavailable.' })
    } });
    if (config.REQUIRE_MALWARE_SCAN) await fileQueue.add('malware-scan', { fileId, storageKey, ownerId: userId, version }, { jobId: `scan-${fileId}-v${version}` });
    return FileRecord.findById(fileId);
  } catch (error) {
    await releaseQuota(userId, workspaceId, upload.size);
    try { await storage.delete(storageKey); } catch { /* best effort rollback */ }
    throw error;
  }
};

export const restoreFileVersion = async (fileId: string, versionNumber: number, userId: string) => {
  const file = await FileRecord.findById(fileId).select('+storageKey');
  if (!file || file.ownerId.toString() !== userId) throw new AppError(404, 'FILE_NOT_FOUND', 'The requested file was not found.');
  const source = await FileVersion.findOne({ fileId, version: versionNumber }).select('+storageKey');
  if (!source) throw new AppError(404, 'FILE_VERSION_NOT_FOUND', 'The requested file version was not found.');
  if (source.securityStatus !== 'CLEAN') throw new AppError(423, source.securityStatus === 'BLOCKED' ? 'FILE_QUARANTINED' : 'FILE_SCAN_PENDING', 'This version is unavailable until security processing completes.');
  const workspaceId = file.workspaceId?.toString();
  await reserveQuota(userId, workspaceId, source.size, 'FILE_UPDATE');
  const nextVersion = file.currentVersion + 1;
  const storageKey = `${workspaceId ? `workspaces/${workspaceId}` : `users/${userId}`}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  try {
    await storage.copy(source.storageKey, storageKey);
    await FileVersion.create({ fileId, version: nextVersion, size: source.size, sha256: source.sha256, storageKey, mimeType: source.mimeType, uploadedBy: userId });
    await FileRecord.updateOne({ _id: fileId }, { $set: { currentVersion: nextVersion, storageKey, size: source.size, sha256: source.sha256, mimeType: source.mimeType, securityStatus: 'CLEAN' } });
    return FileRecord.findById(fileId);
  } catch (error) {
    await releaseQuota(userId, workspaceId, source.size);
    try { await storage.delete(storageKey); } catch { /* best effort rollback */ }
    throw error;
  }
};

export const permanentlyDeleteFile = async (fileId: string): Promise<void> => {
  const file = await FileRecord.findById(fileId).select('+storageKey');
  if (!file) return;
  const versions = await FileVersion.find({ fileId }).select('+storageKey');
  const keys = new Set([file.storageKey, ...versions.map((version) => version.storageKey)]);
  for (const key of keys) await storage.delete(key);
  const totalBytes = versions.reduce((sum, version) => sum + version.size, 0);
  await FileVersion.deleteMany({ fileId });
  await FileRecord.deleteOne({ _id: fileId });
  await releaseQuota(file.ownerId.toString(), file.workspaceId?.toString(), totalBytes || file.size);
};

export const updateFileDetails = async (
  fileId: string,
  userId: string,
  input: { displayName?: string; folderId?: string | null }
) => {
  const file = await FileRecord.findById(fileId);
  if (!file || file.ownerId.toString() !== userId) throw new AppError(404, 'FILE_NOT_FOUND', 'The requested file was not found.');
  if (file.isDeleted) throw new AppError(409, 'FILE_DELETED', 'Restore this file before changing it.');
  if (input.displayName !== undefined) {
    const name = sanitizeName(input.displayName);
    if (path.extname(name).toLowerCase() !== path.extname(file.displayName).toLowerCase()) {
      throw new AppError(422, 'FILE_EXTENSION_MISMATCH', 'The filename extension cannot be changed.');
    }
    file.displayName = name;
  }
  if (input.folderId !== undefined) {
    if (input.folderId) {
      const folder = await Folder.findById(input.folderId);
      if (!folder || folder.ownerId.toString() !== userId || (folder.workspaceId?.toString() ?? null) !== (file.workspaceId?.toString() ?? null)) {
        throw new AppError(404, 'FOLDER_NOT_FOUND', 'The destination folder was not found.');
      }
      file.folderId = folder._id;
    } else {
      file.folderId = null;
    }
  }
  await file.save();
  return file;
};
