import type { Request } from 'express';
import { AuditLog, SecurityEvent } from '../models';

const safeMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const blocked = /password|token|secret|authorization|cookie|content/i;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.test(key)));
};

export const writeAudit = async (
  req: Request,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {}
): Promise<void> => {
  await AuditLog.create({
    actorId: req.auth?.id,
    action,
    resourceType,
    resourceId,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
    metadata: safeMetadata(metadata)
  });
};

export const writeSecurityEvent = async (
  req: Request,
  type: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  resourceType?: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {}
): Promise<void> => {
  await SecurityEvent.create({
    type,
    severity,
    userId: req.auth?.id,
    ip: req.ip,
    device: req.get('user-agent'),
    resourceType,
    resourceId,
    requestId: req.requestId,
    metadata: safeMetadata(metadata)
  });
};
