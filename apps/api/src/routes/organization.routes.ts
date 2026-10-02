import { Router } from 'express';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@cloudvault/types';
import { workspaceHasPermission } from '@cloudvault/security';
import { authenticate } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { Organization, OrganizationInvitation, OrganizationMember, User } from '../models';
import { writeAudit } from '../services/audit.service';
import { createNotification } from '../services/notification.service';

export const organizationRouter = Router();
organizationRouter.use(authenticate);

const requireOrganizationPermission = async (organizationId: string, userId: string, permission: 'MEMBER_INVITE' | 'MEMBER_REMOVE') => {
  const member = await OrganizationMember.findOne({ organizationId, userId });
  if (!member || !workspaceHasPermission(member.role as WorkspaceRole, permission)) throw new AppError(403, 'AUTH_FORBIDDEN', 'You cannot manage members in this organization.');
  return member;
};

organizationRouter.get('/', async (req, res) => {
  const memberships = await OrganizationMember.find({ userId: req.auth!.id }).populate('organizationId');
  res.json({ success: true, data: { organizations: memberships } });
});

organizationRouter.get('/invitations', async (req, res) => {
  const invitations = await OrganizationInvitation.find({
    userId: req.auth!.id,
    status: 'PENDING',
    expiresAt: { $gt: new Date() }
  }).populate('organizationId', 'name');
  res.json({ success: true, data: { invitations } });
});

organizationRouter.post('/', async (req, res) => {
  if (typeof req.body.name !== 'string' || req.body.name.trim().length < 2 || req.body.name.length > 100) throw new AppError(422, 'VALIDATION_FAILED', 'A valid organization name is required.');
  const organization = await Organization.create({ name: req.body.name.trim(), ownerId: req.auth!.id });
  await OrganizationMember.create({ organizationId: organization.id, userId: req.auth!.id, role: 'OWNER', invitedBy: req.auth!.id });
  res.status(201).json({ success: true, data: { organization } });
});

organizationRouter.get('/:id/members', async (req, res) => {
  if (!(await OrganizationMember.exists({ organizationId: req.params.id, userId: req.auth!.id }))) throw new AppError(403, 'AUTH_FORBIDDEN', 'You are not a member of this organization.');
  const members = await OrganizationMember.find({ organizationId: req.params.id }).populate('userId', 'name email');
  res.json({ success: true, data: { members } });
});

organizationRouter.post('/:id/members', async (req, res) => {
  await requireOrganizationPermission(req.params.id, req.auth!.id, 'MEMBER_INVITE');
  if (typeof req.body.email !== 'string' || !WORKSPACE_ROLES.includes(req.body.role) || req.body.role === 'OWNER') throw new AppError(422, 'VALIDATION_FAILED', 'A valid email and assignable workspace role are required.');
  const user = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Invitee must have a CloudVault account.');
  if (await OrganizationMember.exists({ organizationId: req.params.id, userId: user.id })) throw new AppError(409, 'MEMBER_ALREADY_EXISTS', 'This user is already a member of the organization.');
  const invitation = await OrganizationInvitation.findOneAndUpdate(
    { organizationId: req.params.id, userId: user.id, status: 'PENDING' },
    {
      $set: { role: req.body.role, invitedBy: req.auth!.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
      $setOnInsert: { status: 'PENDING' }
    },
    { upsert: true, new: true }
  );
  await createNotification({ userId: user.id, type: 'WORKSPACE_INVITATION', title: 'Organization invitation', message: 'You have a pending invitation to an organization workspace.', resourceType: 'organization', resourceId: req.params.id });
  await writeAudit(req, 'MEMBER_INVITED', 'organization', req.params.id, { memberId: user.id, role: req.body.role });
  res.status(202).json({ success: true, data: { invitation } });
});

organizationRouter.post('/invitations/:id/accept', async (req, res) => {
  const invitationId = String(req.params.id);
  const invitation = await OrganizationInvitation.findOneAndUpdate(
    { _id: invitationId, userId: req.auth!.id, status: 'PENDING', expiresAt: { $gt: new Date() } },
    { $set: { status: 'ACCEPTED' } },
    { new: true }
  );
  if (!invitation) throw new AppError(404, 'INVITATION_NOT_FOUND', 'The pending invitation was not found or has expired.');
  try {
    const member = await OrganizationMember.create({
      organizationId: invitation.organizationId,
      userId: invitation.userId,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      joinedAt: new Date()
    });
    await writeAudit(req, 'INVITATION_ACCEPTED', 'organization', invitation.organizationId.toString(), { invitationId });
    res.json({ success: true, data: { member } });
  } catch (error) {
    await OrganizationInvitation.updateOne({ _id: invitation._id, status: 'ACCEPTED' }, { $set: { status: 'PENDING' } });
    throw error;
  }
});

organizationRouter.patch('/:id/members/:memberId', async (req, res) => {
  await requireOrganizationPermission(req.params.id, req.auth!.id, 'MEMBER_REMOVE');
  if (!WORKSPACE_ROLES.includes(req.body.role) || req.body.role === 'OWNER') throw new AppError(422, 'VALIDATION_FAILED', 'A valid assignable role is required.');
  const member = await OrganizationMember.findOneAndUpdate({ _id: req.params.memberId, organizationId: req.params.id, role: { $ne: 'OWNER' } }, { $set: { role: req.body.role } }, { new: true });
  if (!member) throw new AppError(404, 'MEMBER_NOT_FOUND', 'The member was not found.');
  await writeAudit(req, 'ROLE_CHANGED', 'organization', req.params.id, { memberId: member.id, role: req.body.role });
  res.json({ success: true, data: { member } });
});

organizationRouter.delete('/:id/members/:memberId', async (req, res) => {
  await requireOrganizationPermission(req.params.id, req.auth!.id, 'MEMBER_REMOVE');
  const result = await OrganizationMember.deleteOne({ _id: req.params.memberId, organizationId: req.params.id, role: { $ne: 'OWNER' } });
  if (!result.deletedCount) throw new AppError(404, 'MEMBER_NOT_FOUND', 'The removable member was not found.');
  res.status(204).send();
});
