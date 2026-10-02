import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Permission, RiskResult, UserRole, WorkspaceRole } from '@cloudvault/types';

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  USER: ['FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE', 'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE'],
  ORGANIZATION_MEMBER: ['FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE', 'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE'],
  ORGANIZATION_ADMIN: ['FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE', 'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE', 'MEMBER_INVITE', 'MEMBER_REMOVE', 'AUDIT_READ', 'SECURITY_READ'],
  SYSTEM_ADMIN: ['AUDIT_READ', 'SECURITY_READ', 'ADMIN_ACCESS']
};

const WORKSPACE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  OWNER: ['FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE', 'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE', 'MEMBER_INVITE', 'MEMBER_REMOVE', 'AUDIT_READ', 'SECURITY_READ'],
  ADMIN: ['FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE', 'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE', 'MEMBER_INVITE', 'MEMBER_REMOVE', 'AUDIT_READ', 'SECURITY_READ'],
  MEMBER: ['FILE_CREATE', 'FILE_READ', 'FILE_UPDATE', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_SHARE', 'FILE_RESTORE', 'FOLDER_CREATE', 'FOLDER_MANAGE'],
  VIEWER: ['FILE_READ', 'FILE_DOWNLOAD']
};

export const hasPermission = (role: UserRole, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);
export const workspaceHasPermission = (role: WorkspaceRole, permission: Permission) => WORKSPACE_PERMISSIONS[role].includes(permission);

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const createOpaqueToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const secureStringEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface RiskSignals {
  loginFailures?: number;
  newDevice?: boolean;
  downloadsLastHour?: number;
  sharePasswordFailures?: number;
  unauthorizedAttempts?: number;
  malwareDetected?: boolean;
  tokenReuse?: boolean;
}

export const scoreRisk = (signals: RiskSignals): RiskResult => {
  const reasons: string[] = [];
  let riskScore = 0;
  if ((signals.loginFailures ?? 0) >= 5) { riskScore += 25; reasons.push('Repeated login failures'); }
  if (signals.newDevice) { riskScore += 10; reasons.push('New device'); }
  if ((signals.downloadsLastHour ?? 0) >= 50) { riskScore += 20; reasons.push('Unusually high download volume'); }
  if ((signals.sharePasswordFailures ?? 0) >= 5) { riskScore += 20; reasons.push('Repeated share password failures'); }
  if ((signals.unauthorizedAttempts ?? 0) >= 3) { riskScore += 20; reasons.push('Repeated unauthorized requests'); }
  if (signals.malwareDetected) { riskScore += 60; reasons.push('Malware detected'); }
  if (signals.tokenReuse) { riskScore += 45; reasons.push('Refresh token reuse'); }
  riskScore = Math.min(riskScore, 100);
  const severity = riskScore >= 75 ? 'CRITICAL' : riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW';
  const recommendedAction = severity === 'CRITICAL' ? 'Block the operation and require incident review.' : severity === 'HIGH' ? 'Require re-authentication and review active sessions.' : severity === 'MEDIUM' ? 'Notify the user and increase monitoring.' : 'Continue with standard monitoring.';
  return { riskScore, severity, signals: reasons, recommendedAction };
};
