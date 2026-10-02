import { workspaceHasPermission } from '@cloudvault/security';
import type { Permission, WorkspaceRole } from '@cloudvault/types';
import { FileRecord, Folder, OrganizationMember } from '../models';
import { AppError } from '../lib/errors';

export const authorizeFile = async (fileId: string, userId: string, permission: Permission) => {
  const file = await FileRecord.findById(fileId).select('+storageKey');
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'The requested file was not found.');
  if (file.ownerId.toString() === userId) return file;
  if (file.workspaceId) {
    const member = await OrganizationMember.findOne({ organizationId: file.workspaceId, userId });
    if (member && workspaceHasPermission(member.role as WorkspaceRole, permission)) return file;
  }
  throw new AppError(403, 'FILE_ACCESS_DENIED', 'You do not have access to this file.');
};

export const authorizeFolder = async (folderId: string, userId: string, permission: Permission) => {
  const folder = await Folder.findById(folderId);
  if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', 'The requested folder was not found.');
  if (folder.ownerId.toString() === userId) return folder;
  if (folder.workspaceId) {
    const member = await OrganizationMember.findOne({ organizationId: folder.workspaceId, userId });
    if (member && workspaceHasPermission(member.role as WorkspaceRole, permission)) return folder;
  }
  throw new AppError(403, 'FOLDER_ACCESS_DENIED', 'You do not have access to this folder.');
};
