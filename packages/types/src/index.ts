export const USER_ROLES = ['USER', 'ORGANIZATION_MEMBER', 'ORGANIZATION_ADMIN', 'SYSTEM_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  'FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE',
  'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE', 'MEMBER_INVITE', 'MEMBER_REMOVE',
  'AUDIT_READ', 'SECURITY_READ', 'ADMIN_ACCESS'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const FILE_SECURITY_STATUSES = [
  'UPLOAD_RECEIVED', 'QUARANTINED', 'SCAN_PENDING', 'SCANNING', 'CLEAN', 'BLOCKED', 'SCAN_FAILED'
] as const;
export type FileSecurityStatus = (typeof FILE_SECURITY_STATUSES)[number];

export const SHARE_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED', 'EXHAUSTED'] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];

export const SECURITY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; requestId: string };
}

export interface ApiSuccess<T> { success: true; data: T }

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

export interface RiskResult {
  riskScore: number;
  severity: SecuritySeverity;
  signals: string[];
  recommendedAction: string;
}
