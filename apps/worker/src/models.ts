import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

const objectId = Schema.Types.ObjectId;
const fileSchema = new Schema({
  ownerId: { type: objectId, required: true },
  workspaceId: objectId,
  storageKey: { type: String, required: true, select: false },
  displayName: String,
  size: Number,
  securityStatus: String,
  securityMessage: String,
  isDeleted: Boolean,
  deletedAt: Date
}, { timestamps: true, collection: 'files' });

const fileVersionSchema = new Schema({ fileId: objectId, storageKey: { type: String, select: false }, size: Number }, { collection: 'fileversions' });
const shareSchema = new Schema({ ownerId: objectId, fileId: objectId, expiresAt: Date, revokedAt: Date }, { timestamps: true, collection: 'shares' });
const notificationSchema = new Schema({ userId: objectId, type: String, title: String, message: String, resourceType: String, resourceId: objectId, readAt: Date }, { timestamps: true, collection: 'notifications' });
const auditSchema = new Schema({ actorId: objectId, action: String, resourceType: String, resourceId: objectId, requestId: String, metadata: Schema.Types.Mixed }, { timestamps: { createdAt: true, updatedAt: false }, collection: 'auditlogs' });
const securitySchema = new Schema({ type: String, severity: String, userId: objectId, resourceType: String, resourceId: objectId, status: String, metadata: Schema.Types.Mixed }, { timestamps: true, collection: 'securityevents' });
const userSchema = new Schema({ storageUsedBytes: Number }, { collection: 'users' });
const organizationSchema = new Schema({ storageUsedBytes: Number }, { collection: 'organizations' });

export const FileRecord = (models.WorkerFile ?? model('WorkerFile', fileSchema)) as Model<InferSchemaType<typeof fileSchema>>;
export const FileVersion = (models.WorkerFileVersion ?? model('WorkerFileVersion', fileVersionSchema)) as Model<InferSchemaType<typeof fileVersionSchema>>;
export const Share = (models.WorkerShare ?? model('WorkerShare', shareSchema)) as Model<InferSchemaType<typeof shareSchema>>;
export const Notification = (models.WorkerNotification ?? model('WorkerNotification', notificationSchema)) as Model<InferSchemaType<typeof notificationSchema>>;
export const AuditLog = (models.WorkerAuditLog ?? model('WorkerAuditLog', auditSchema)) as Model<InferSchemaType<typeof auditSchema>>;
export const SecurityEvent = (models.WorkerSecurityEvent ?? model('WorkerSecurityEvent', securitySchema)) as Model<InferSchemaType<typeof securitySchema>>;
export const User = (models.WorkerUser ?? model('WorkerUser', userSchema)) as Model<InferSchemaType<typeof userSchema>>;
export const Organization = (models.WorkerOrganization ?? model('WorkerOrganization', organizationSchema)) as Model<InferSchemaType<typeof organizationSchema>>;
