import { Types } from 'mongoose';
import { AppError } from '../lib/errors';
import { Folder } from '../models';
import { authorizeFolder } from './authorization.service';

export const moveFolder = async (folderId: string, parentId: string | null, userId: string) => {
  const folder = await authorizeFolder(folderId, userId, 'FOLDER_MANAGE');
  if (!parentId) {
    folder.parentId = null;
    await folder.save();
    return folder;
  }
  if (parentId === folderId) throw new AppError(409, 'FOLDER_INVALID_HIERARCHY', 'A folder cannot be moved inside itself.');
  const parent = await authorizeFolder(parentId, userId, 'FOLDER_MANAGE');
  if ((parent.workspaceId?.toString() ?? undefined) !== (folder.workspaceId?.toString() ?? undefined)) {
    throw new AppError(409, 'FOLDER_WORKSPACE_MISMATCH', 'Folders cannot be moved across workspace boundaries.');
  }
  let currentParentId: string | null = parentId;
  while (currentParentId !== null) {
    const ancestor: { _id: Types.ObjectId; parentId?: Types.ObjectId | null } | null =
      await Folder.findById(currentParentId).select('parentId').lean();
    if (!ancestor) break;
    if (ancestor._id.toString() === folderId) throw new AppError(409, 'FOLDER_INVALID_HIERARCHY', 'A folder cannot be moved inside one of its descendants.');
    currentParentId = ancestor.parentId?.toString() ?? null;
  }
  folder.parentId = new Types.ObjectId(parentId) as typeof folder.parentId;
  await folder.save();
  return folder;
};
