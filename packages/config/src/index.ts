import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const developmentSecret = (fallback: string, minLength: number) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string' && value.length > 0) return value;
      if (process.env.NODE_ENV === 'production') return undefined;
      return fallback;
    },
    z.string().min(minLength)
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.url().default('http://localhost:3000'),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/cloudvault'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: developmentSecret('development-access-secret-at-least-32-bytes', 32),
  JWT_REFRESH_SECRET: developmentSecret('development-refresh-secret-at-least-32-bytes', 32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: booleanString.default(false),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: booleanString.default(false),
  MINIO_ACCESS_KEY: developmentSecret('cloudvault-local', 1),
  MINIO_SECRET_KEY: developmentSecret('cloudvault-local-secret-key', 8),
  MINIO_BUCKET: z.string().min(3).default('cloudvault-private'),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(26_214_400),
  ALLOWED_MIME_TYPES: z.string().default('application/pdf,image/jpeg,image/png,text/plain'),
  TOTP_ENCRYPTION_KEY: developmentSecret('development-totp-encryption-key-123456', 32),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  REQUIRE_MALWARE_SCAN: booleanString.default(true),
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  LOG_LEVEL: z.string().default('info')
});

export type AppConfig = z.infer<typeof schema> & { allowedMimeTypes: string[] };

let cached: AppConfig | undefined;
export const getConfig = (): AppConfig => {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  cached = { ...result.data, allowedMimeTypes: result.data.ALLOWED_MIME_TYPES.split(',').map((value) => value.trim()) };
  return cached;
};

export const clearConfigCacheForTests = (): void => { cached = undefined; };
