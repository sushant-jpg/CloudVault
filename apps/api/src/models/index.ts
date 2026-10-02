import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';
import { FILE_SECURITY_STATUSES, SECURITY_SEVERITIES, USER_ROLES, WORKSPACE_ROLES } from '@cloudvault/types';

const objectId = Schema.Types.ObjectId;
const baseOptions = { timestamps: true, versionKey: false } as const;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: USER_ROLES, default: 'USER' },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpiresAt: Date,
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: Date,
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecretEncrypted: { type: String, select: false },
  recoveryCodeHashes: { type: [String], select: false, default: [] },
  failedLoginCount: { type: Number, default: 0 },
  lockUntil: Date,
  storageUsedBytes: { type: Number, default: 0, min: 0 },
  storageQuotaBytes: { type: Number, default: 5 * 1024 * 1024 * 1024 }
}, baseOptions);

const sessionSchema = new Schema({
  userId: { type: objectId, required: true, index: true, ref: 'User' },
  tokenHash: { type: String, required: true, unique: true, select: false },
  familyId: { type: String, required: true, index: true },
  device: { type: String, required: true },
  ip: { type: String, required: true },
  userAgent: { type: String, required: true },
  lastActivityAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: Date,
  revokedReason: String,
  replacedBySessionId: { type: objectId, ref: 'Session' }
}, baseOptions);

const organizationSchema = new Schema({
  name: { type: String, required: true, trim: true },
  ownerId: { type: objectId, required: true, index: true, ref: 'User' },
  storageUsedBytes: { type: Number, default: 0, min: 0 },
  storageQuotaBytes: { type: Number, default: 50 * 1024 * 1024 * 1024 }
}, baseOptions);

const organizationMemberSchema = new Schema({
  organizationId: { type: objectId, required: true, index: true, ref: 'Organization' },
  userId: { type: objectId, required: true, index: true, ref: 'User' },
  role: { type: String, enum: WORKSPACE_ROLES, required: true },
  invitedBy: { type: objectId, required: true, ref: 'User' },
  joinedAt: { type: Date, default: Date.now }
}, baseOptions);
organizationMemberSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

const organizationInvitationSchema = new Schema({
  organizationId: { type: objectId, required: true, index: true, ref: 'Organization' },
  userId: { type: objectId, required: true, index: true, ref: 'User' },
  role: { type: String, enum: WORKSPACE_ROLES, required: true },
  invitedBy: { type: objectId, required: true, ref: 'User' },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED'], default: 'PENDING', index: true },
  expiresAt: { type: Date, required: true, index: true }
}, baseOptions);
organizationInvitationSchema.index({ organizationId: 1, userId: 1, status: 1 }, { unique: true });

const folderSchema = new Schema({
  ownerId: { type: objectId, required: true, index: true, ref: 'User' },
  workspaceId: { type: objectId, default: null, index: true, ref: 'Organization' },
  parentId: { type: objectId, default: null, index: true, ref: 'Folder' },
  name: { type: String, required: true, trim: true },
  deletedAt: Date,
  deletedBy: { type: objectId, ref: 'User' }
}, baseOptions);
folderSchema.index({ ownerId: 1, workspaceId: 1, parentId: 1, name: 1 });

const fileSchema = new Schema({
  ownerId: { type: objectId, required: true, index: true, ref: 'User' },
  workspaceId: { type: objectId, default: null, index: true, ref: 'Organization' },
  folderId: { type: objectId, default: null, index: true, ref: 'Folder' },
  originalFilename: { type: String, required: true },
  displayName: { type: String, required: true, trim: true },
  storageKey: { type: String, required: true, unique: true, select: false },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true, min: 1 },
  sha256: { type: String, required: true, index: true },
  securityStatus: { type: String, enum: FILE_SECURITY_STATUSES, default: 'QUARANTINED', index: true },
  securityMessage: String,
  currentVersion: { type: Number, default: 1 },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: Date,
  deletedBy: { type: objectId, ref: 'User' }
}, baseOptions);
fileSchema.index({ ownerId: 1, folderId: 1, isDeleted: 1, createdAt: -1 });
fileSchema.index({ workspaceId: 1, folderId: 1, isDeleted: 1, createdAt: -1 });

const fileVersionSchema = new Schema({
  fileId: { type: objectId, required: true, index: true, ref: 'File' },
  version: { type: Number, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  storageKey: { type: String, required: true, unique: true, select: false },
  mimeType: { type: String, required: true },
  securityStatus: { type: String, enum: FILE_SECURITY_STATUSES, default: 'QUARANTINED', index: true },
  uploadedBy: { type: objectId, required: true, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now }
}, { versionKey: false });
fileVersionSchema.index({ fileId: 1, version: 1 }, { unique: true });

const shareSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true, select: false },
  fileId: { type: objectId, required: true, index: true, ref: 'File' },
  ownerId: { type: objectId, required: true, index: true, ref: 'User' },
  passwordHash: { type: String, select: false },
  expiresAt: { type: Date, required: true, index: true },
  maxDownloads: { type: Number, default: null },
  downloadCount: { type: Number, default: 0, min: 0 },
  accessCount: { type: Number, default: 0, min: 0 },
  recipientEmail: { type: String, lowercase: true, trim: true },
  requireAuthentication: { type: Boolean, default: false },
  oneTime: { type: Boolean, default: false },
  allowDownload: { type: Boolean, default: true },
  note: String,
  revokedAt: Date,
  revokedBy: { type: objectId, ref: 'User' },
  consumedAt: Date,
  expiredNotificationSentAt: Date
}, baseOptions);
shareSchema.index({ ownerId: 1, createdAt: -1 });
shareSchema.index({ fileId: 1, revokedAt: 1, expiresAt: 1 });

const shareAccessEventSchema = new Schema({
  shareId: { type: objectId, required: true, index: true, ref: 'Share' },
  fileId: { type: objectId, required: true, ref: 'File' },
  userId: { type: objectId, ref: 'User' },
  recipientEmail: String,
  outcome: { type: String, required: true },
  ip: String,
  userAgent: String,
  requestId: String
}, baseOptions);

const notificationSchema = new Schema({
  userId: { type: objectId, required: true, index: true, ref: 'User' },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  resourceType: String,
  resourceId: objectId,
  readAt: Date
}, baseOptions);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

const auditLogSchema = new Schema({
  actorId: { type: objectId, index: true, ref: 'User' },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, required: true },
  resourceId: { type: objectId, index: true },
  ip: String,
  userAgent: String,
  requestId: { type: String, required: true, index: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

const securityEventSchema = new Schema({
  type: { type: String, required: true, index: true },
  severity: { type: String, enum: SECURITY_SEVERITIES, required: true, index: true },
  userId: { type: objectId, index: true, ref: 'User' },
  ip: String,
  device: String,
  resourceType: String,
  resourceId: objectId,
  requestId: { type: String, index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'], default: 'OPEN', index: true }
}, baseOptions);
securityEventSchema.index({ userId: 1, severity: 1, createdAt: -1 });

export type UserDocument = InferSchemaType<typeof userSchema>;
export type FileDocument = InferSchemaType<typeof fileSchema>;

export const User = (models.User ?? model('User', userSchema)) as Model<UserDocument>;
export const Session = (models.Session ?? model('Session', sessionSchema)) as Model<InferSchemaType<typeof sessionSchema>>;
export const Organization = (models.Organization ?? model('Organization', organizationSchema)) as Model<InferSchemaType<typeof organizationSchema>>;
export const OrganizationMember = (models.OrganizationMember ?? model('OrganizationMember', organizationMemberSchema)) as Model<InferSchemaType<typeof organizationMemberSchema>>;
export const OrganizationInvitation = (models.OrganizationInvitation ?? model('OrganizationInvitation', organizationInvitationSchema)) as Model<InferSchemaType<typeof organizationInvitationSchema>>;
export const Folder = (models.Folder ?? model('Folder', folderSchema)) as Model<InferSchemaType<typeof folderSchema>>;
export const FileRecord = (models.File ?? model('File', fileSchema)) as Model<FileDocument>;
export const FileVersion = (models.FileVersion ?? model('FileVersion', fileVersionSchema)) as Model<InferSchemaType<typeof fileVersionSchema>>;
export const Share = (models.Share ?? model('Share', shareSchema)) as Model<InferSchemaType<typeof shareSchema>>;
export const ShareAccessEvent = (models.ShareAccessEvent ?? model('ShareAccessEvent', shareAccessEventSchema)) as Model<InferSchemaType<typeof shareAccessEventSchema>>;
export const Notification = (models.Notification ?? model('Notification', notificationSchema)) as Model<InferSchemaType<typeof notificationSchema>>;
export const AuditLog = (models.AuditLog ?? model('AuditLog', auditLogSchema)) as Model<InferSchemaType<typeof auditLogSchema>>;
export const SecurityEvent = (models.SecurityEvent ?? model('SecurityEvent', securityEventSchema)) as Model<InferSchemaType<typeof securityEventSchema>>;
