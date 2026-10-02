import { Router } from 'express';
import { workspaceHasPermission } from '@cloudvault/security';
import { folderSchema, moveFolderSchema } from '@cloudvault/validation';
import type { WorkspaceRole } from '@cloudvault/types';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { AppError } from '../lib/errors';
import { Folder, OrganizationMember } from '../models';
import { authorizeFolder } from '../services/authorization.service';
import { moveFolder } from '../services/folder.service';

export const folderRouter = Router();
folderRouter.use(authenticate);

folderRouter.get('/', requirePermission('FILE_READ'), async (req, res) => {
  const memberships = await OrganizationMember.find({ userId: req.auth!.id }).distinct('organizationId');
  const parentId = typeof req.query.parentId === 'string' && req.query.parentId !== 'root' ? req.query.parentId : null;
  const folders = await Folder.find({ $or: [{ ownerId: req.auth!.id }, { workspaceId: { $in: memberships } }], parentId, deletedAt: null }).sort({ name: 1 });
  res.json({ success: true, data: { folders } });
});

folderRouter.post('/', requirePermission('FOLDER_CREATE'), validateBody(folderSchema), async (req, res) => {
  const parentId = typeof req.body.parentId === 'string' && req.body.parentId ? req.body.parentId : undefined;
  const workspaceId = typeof req.body.workspaceId === 'string' && req.body.workspaceId ? req.body.workspaceId : undefined;
  if (parentId) {
    const parent = await authorizeFolder(parentId, req.auth!.id, 'FOLDER_CREATE');
    if ((parent.workspaceId?.toString() ?? undefined) !== workspaceId) throw new AppError(409, 'FOLDER_WORKSPACE_MISMATCH', 'The parent folder does not belong to the selected workspace.');
  }
  if (workspaceId) {
    const member = await OrganizationMember.findOne({ organizationId: workspaceId, userId: req.auth!.id });
    if (!member || !workspaceHasPermission(member.role as WorkspaceRole, 'FOLDER_CREATE')) throw new AppError(403, 'FOLDER_ACCESS_DENIED', 'You do not have permission to create folders in this workspace.');
  }
  const folder = await Folder.create({ ...req.body, ownerId: req.auth!.id, parentId, workspaceId });
  res.status(201).json({ success: true, data: { folder } });
});

folderRouter.patch('/:id', requirePermission('FOLDER_MANAGE'), async (req, res) => {
  const folderId = String(req.params.id);
  const folder = await authorizeFolder(folderId, req.auth!.id, 'FOLDER_MANAGE');
  if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 120) throw new AppError(422, 'VALIDATION_FAILED', 'A valid folder name is required.');
  folder.name = req.body.name.trim();
  await folder.save();
  res.json({ success: true, data: { folder } });
});

folderRouter.post('/:id/move', requirePermission('FOLDER_MANAGE'), validateBody(moveFolderSchema), async (req, res) => {
  const folderId = String(req.params.id);
  res.json({ success: true, data: { folder: await moveFolder(folderId, req.body.parentId, req.auth!.id) } });
});

folderRouter.delete('/:id', requirePermission('FOLDER_MANAGE'), async (req, res) => {
  const folderId = String(req.params.id);
  const folder = await authorizeFolder(folderId, req.auth!.id, 'FOLDER_MANAGE');
  folder.deletedAt = new Date();
  folder.deletedBy = req.auth!.id as never;
  await folder.save();
  res.status(204).send();
});

folderRouter.post('/:id/restore', requirePermission('FOLDER_MANAGE'), async (req, res) => {
  const folderId = String(req.params.id);
  const folder = await authorizeFolder(folderId, req.auth!.id, 'FOLDER_MANAGE');
  folder.deletedAt = undefined;
  folder.deletedBy = undefined;
  await folder.save();
  res.json({ success: true, data: { folder } });
});
