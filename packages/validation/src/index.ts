import { z } from 'zod';

const password = z.string().min(12).max(128).regex(/[a-z]/, 'Include a lowercase letter').regex(/[A-Z]/, 'Include an uppercase letter').regex(/\d/, 'Include a number');

export const registerSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(80),
  password
});

export const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(64).optional()
});

export const refreshSchema = z.object({ refreshToken: z.string().min(32).optional() });
export const resetRequestSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
export const resetPasswordSchema = z.object({ token: z.string().min(32), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullable().optional(), workspaceId: z.string().nullable().optional() });
export const moveFolderSchema = z.object({ parentId: z.string().nullable() });

export const createShareSchema = z.object({
  fileId: z.string().min(1),
  expiresInHours: z.number().positive().max(24 * 365).default(24),
  password: z.string().min(8).max(128).optional(),
  maxDownloads: z.number().int().positive().max(10000).nullable().optional(),
  recipientEmail: z.email().transform((value) => value.toLowerCase()).nullable().optional(),
  requireAuthentication: z.boolean().default(false),
  oneTime: z.boolean().default(false),
  allowDownload: z.boolean().default(true),
  note: z.string().trim().max(500).nullable().optional()
});

export const shareAccessSchema = z.object({ password: z.string().max(128).optional(), intent: z.enum(['preview', 'download']).default('download') });
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
