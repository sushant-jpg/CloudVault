import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '4000';
  process.env.WEB_URL = 'http://localhost:3000';
  process.env.MONGODB_URI = 'mongodb://localhost:27017/cloudvault';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET = '12345678901234567890123456789012';
  process.env.JWT_REFRESH_SECRET = 'abcdefghijklmnopqrstuvwxzy123456';
  process.env.MINIO_ACCESS_KEY = 'cloudvault-local';
  process.env.MINIO_SECRET_KEY = 'cloudvault-local-secret';
  process.env.TOTP_ENCRYPTION_KEY = '12345678901234567890123456789012';
});

describe('file validation', () => {
  it('loads the app config with the allowed MIME types', async () => {
    const { clearConfigCacheForTests, getConfig } = await import('@cloudvault/config');
    clearConfigCacheForTests();
    const config = getConfig();
    expect(config.allowedMimeTypes).toContain('application/pdf');
    expect(config.allowedMimeTypes).toContain('image/png');
  });

  it('accepts a valid PDF upload and rejects empty files', async () => {
    const { inspectUpload } = await import('./file.service');

    const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const result = await inspectUpload({
      buffer: validPdf,
      originalname: 'quarterly-report.pdf',
      size: validPdf.length
    } as Express.Multer.File);

    expect(result.displayName).toBe('quarterly-report.pdf');
    expect(result.mimeType).toBe('application/pdf');
    await expect(inspectUpload({
      buffer: Buffer.alloc(0),
      originalname: 'empty.pdf',
      size: 0
    } as Express.Multer.File)).rejects.toMatchObject({ code: 'FILE_EMPTY' });
  });
});
