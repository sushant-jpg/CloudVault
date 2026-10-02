import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integrationEnabled = process.env.CLOUDVAULT_INTEGRATION === '1';
const minioIntegrationEnabled = integrationEnabled && process.env.CLOUDVAULT_MINIO_INTEGRATION === '1';

if (integrationEnabled) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '4000',
    WEB_URL: 'http://localhost:3000',
    MONGODB_URI: process.env.CLOUDVAULT_TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cloudvault_integration',
    REDIS_URL: process.env.CLOUDVAULT_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
    JWT_ACCESS_SECRET: 'cloudvault-integration-access-secret-32',
    JWT_REFRESH_SECRET: 'cloudvault-integration-refresh-secret-32',
    MINIO_ENDPOINT: process.env.CLOUDVAULT_TEST_MINIO_ENDPOINT ?? '127.0.0.1',
    MINIO_PORT: process.env.CLOUDVAULT_TEST_MINIO_PORT ?? '9000',
    MINIO_ACCESS_KEY: process.env.CLOUDVAULT_TEST_MINIO_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY ?? 'cloudvault-integration',
    MINIO_SECRET_KEY: process.env.CLOUDVAULT_TEST_MINIO_SECRET_KEY ?? process.env.MINIO_SECRET_KEY ?? 'cloudvault-integration-secret',
    TOTP_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    REQUIRE_MALWARE_SCAN: 'true'
  });
}

type TestAccount = { id: string; email: string; password: string; ip: string };
type AuthenticatedAccount = TestAccount & { accessToken: string };
type RuntimeModels = typeof import('../models');

const password = 'Correct-Horse-7-Battery';
const testRunAddress = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
const createdUserIds = new Set<string>();
const createdOrganizationIds = new Set<string>();
const createdFileIds = new Set<string>();
const createdShareIds = new Set<string>();
const createdStorageKeys = new Set<string>();
const securityRequestIds = new Set<string>();
let app: import('express').Express;
let models: RuntimeModels;
let database: typeof import('../lib/database');
let redisModule: typeof import('../lib/redis');
let mongooseModule: typeof import('mongoose');
let nextIp = 1;

const nextTestIp = (): string => {
  const accountIndex = nextIp++;
  const subnetId = ((accountIndex << 8) | Number.parseInt(testRunAddress.slice(4, 6), 16)).toString(16);
  return `2001:db8:${testRunAddress.slice(0, 4)}:${subnetId}::${accountIndex}`;
};

const signup = async (): Promise<TestAccount> => {
  const email = `cloudvault-${crypto.randomUUID()}@example.invalid`;
  const account = { email, password, ip: nextTestIp() };
  const response = await request(app)
    .post('/api/v1/auth/register')
    .set('X-Forwarded-For', account.ip)
    .send({ email, name: 'Integration User', password });
  expect(response.status).toBe(201);
  const id = response.body.data.user.id as string;
  createdUserIds.add(id);
  return { ...account, id };
};

const login = async (account: TestAccount, extra: Record<string, string> = {}): Promise<AuthenticatedAccount> => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', account.ip)
    .send({ email: account.email, password: account.password, ...extra });
  expect(response.status).toBe(200);
  return { ...account, accessToken: response.body.data.accessToken as string };
};

const authenticated = (method: 'get' | 'post' | 'patch' | 'delete', url: string, account: AuthenticatedAccount) =>
  request(app)[method](url)
    .set('Authorization', `Bearer ${account.accessToken}`)
    .set('X-Forwarded-For', account.ip);

const binaryResponse = (requestBuilder: request.Test): request.Test =>
  requestBuilder.buffer(true).parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  });

const cookieValue = (response: request.Response, name: string): string => {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const pair = cookies.find((cookie) => cookie.startsWith(`${name}=`))?.split(';', 1)[0];
  if (!pair) throw new Error(`Expected ${name} cookie in auth response.`);
  return pair.slice(name.length + 1);
};

describe.skipIf(!integrationEnabled)('real MongoDB and Redis integration', () => {
  beforeAll(async () => {
    [database, redisModule, mongooseModule, models] = await Promise.all([
      import('../lib/database'),
      import('../lib/redis'),
      import('mongoose'),
      import('../models')
    ]);
    const { createApp } = await import('../app');
    await Promise.all([database.connectDatabase(), redisModule.connectRedis()]);
    app = createApp();
  }, 30_000);

  afterAll(async () => {
    const userIds = [...createdUserIds];
    const organizationIds = [...createdOrganizationIds];
    const fileIds = [...createdFileIds];
    const shareIds = [...createdShareIds];

    if (userIds.length > 0) {
      if (minioIntegrationEnabled) {
        const { storage } = await import('./storage.service');
        await Promise.all([...createdStorageKeys].map((key) => storage.delete(key)));
      }
      await Promise.all([
        models.ShareAccessEvent.deleteMany({ shareId: { $in: shareIds } }),
        models.Share.deleteMany({ _id: { $in: shareIds } }),
        models.FileVersion.deleteMany({ fileId: { $in: fileIds } }),
        models.FileRecord.deleteMany({ _id: { $in: fileIds } }),
        models.Folder.deleteMany({ ownerId: { $in: userIds } }),
        models.OrganizationMember.deleteMany({ $or: [{ userId: { $in: userIds } }, { organizationId: { $in: organizationIds } }] }),
        models.OrganizationInvitation.deleteMany({ $or: [{ userId: { $in: userIds } }, { organizationId: { $in: organizationIds } }] }),
        models.Organization.deleteMany({ _id: { $in: organizationIds } }),
        models.Notification.deleteMany({ userId: { $in: userIds } }),
        models.AuditLog.deleteMany({ actorId: { $in: userIds } }),
        models.SecurityEvent.deleteMany({ $or: [{ userId: { $in: userIds } }, { requestId: { $in: [...securityRequestIds] } }] }),
        models.Session.deleteMany({ userId: { $in: userIds } }),
        models.User.deleteMany({ _id: { $in: userIds } })
      ]);
    }

    if (mongooseModule) await mongooseModule.default.disconnect();
    if (redisModule && redisModule.redis.status !== 'end') await redisModule.redis.quit();
  }, 30_000);

  it('registers, rotates refresh tokens, revokes a reused token family, and persists sessions and audit logs', async () => {
    const account = await signup();
    const firstLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', account.ip)
      .send({ email: account.email, password: account.password });
    expect(firstLogin.status).toBe(200);
    const initialAccessToken = firstLogin.body.data.accessToken as string;
    const oldRefreshToken = cookieValue(firstLogin, 'cloudvault_refresh');

    const sessions = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .set('X-Forwarded-For', account.ip);
    expect(sessions.status).toBe(200);
    expect(sessions.body.data.sessions).toHaveLength(1);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Forwarded-For', account.ip)
      .send({ refreshToken: oldRefreshToken });
    expect(refreshed.status).toBe(200);
    const rotatedAccessToken = refreshed.body.data.accessToken as string;
    expect(rotatedAccessToken).toBeTruthy();

    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Forwarded-For', account.ip)
      .send({ refreshToken: oldRefreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_TOKEN_REUSE');

    const revokedAccess = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .set('X-Forwarded-For', account.ip);
    expect(revokedAccess.status).toBe(401);

    expect(await models.Session.countDocuments({ userId: account.id })).toBe(2);
    expect(await models.Session.countDocuments({ userId: account.id, revokedReason: 'TOKEN_REUSE' })).toBe(1);
    expect(await models.AuditLog.exists({ actorId: account.id, action: 'LOGIN_SUCCESS' })).not.toBeNull();
    expect(await models.SecurityEvent.exists({ userId: account.id, type: 'SESSION_TOKEN_REUSE' })).not.toBeNull();
  }, 60_000);

  it('enables TOTP, verifies logins, lists sessions, and rejects a revoked session', async () => {
    const account = await signup();
    const firstLogin = await login(account);
    const initialSessions = await authenticated('get', '/api/v1/auth/sessions', firstLogin);
    const firstSessionId = initialSessions.body.data.currentSessionId as string;

    const setup = await authenticated('post', '/api/v1/auth/2fa/setup', firstLogin)
      .send({ password: account.password });
    expect(setup.status).toBe(200);
    const { authenticator } = await import('otplib');
    const code = authenticator.generate(setup.body.data.secret as string);
    const verified = await authenticated('post', '/api/v1/auth/2fa/verify', firstLogin).send({ code });
    expect(verified.status).toBe(200);
    expect(verified.body.data.recoveryCodes).toHaveLength(10);

    const missingCode = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', account.ip)
      .send({ email: account.email, password: account.password });
    expect(missingCode.status).toBe(401);
    expect(missingCode.body.error.code).toBe('AUTH_2FA_REQUIRED');

    const secondLogin = await login(account, { totpCode: authenticator.generate(setup.body.data.secret as string) });
    const revoked = await authenticated('delete', `/api/v1/auth/sessions/${firstSessionId}`, secondLogin);
    expect(revoked.status).toBe(204);

    const oldSessionRequest = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${firstLogin.accessToken}`)
      .set('X-Forwarded-For', account.ip);
    expect(oldSessionRequest.status).toBe(401);
    expect(await models.AuditLog.exists({ actorId: account.id, action: 'TWO_FACTOR_ENABLED' })).not.toBeNull();
  }, 90_000);

  it('persists organization membership, notifications, role changes, and folder hierarchy rules', async () => {
    const owner = await login(await signup());
    const member = await login(await signup());

    const organizationResponse = await authenticated('post', '/api/v1/organizations', owner)
      .send({ name: 'Integration Workspace' });
    expect(organizationResponse.status).toBe(201);
    const organizationId = organizationResponse.body.data.organization._id as string;
    createdOrganizationIds.add(organizationId);

    const invite = await authenticated('post', `/api/v1/organizations/${organizationId}/members`, owner)
      .send({ email: member.email, role: 'MEMBER' });
    expect(invite.status).toBe(202);
    const invitationId = invite.body.data.invitation._id as string;
    expect(await models.OrganizationInvitation.exists({ _id: invitationId, status: 'PENDING' })).not.toBeNull();
    const accepted = await authenticated('post', `/api/v1/organizations/invitations/${invitationId}/accept`, member);
    expect(accepted.status).toBe(200);
    const memberId = accepted.body.data.member._id as string;

    const notifications = await authenticated('get', '/api/v1/notifications', member);
    expect(notifications.status).toBe(200);
    expect(notifications.body.data.notifications.some((item: { type: string }) => item.type === 'WORKSPACE_INVITATION')).toBe(true);

    const sharedFolder = await authenticated('post', '/api/v1/folders', owner)
      .send({ name: 'Shared', workspaceId: organizationId });
    expect(sharedFolder.status).toBe(201);
    const visibleFolders = await authenticated('get', '/api/v1/folders', member);
    expect(visibleFolders.body.data.folders.some((item: { _id: string }) => item._id === sharedFolder.body.data.folder._id)).toBe(true);

    const parentOne = await authenticated('post', '/api/v1/folders', owner).send({ name: 'Parent one' });
    const parentTwo = await authenticated('post', '/api/v1/folders', owner).send({ name: 'Parent two' });
    const child = await authenticated('post', '/api/v1/folders', owner)
      .send({ name: 'Child', parentId: parentOne.body.data.folder._id });
    expect(parentOne.status).toBe(201);
    expect(parentTwo.status).toBe(201);
    expect(child.status).toBe(201);

    const rename = await authenticated('patch', `/api/v1/folders/${parentTwo.body.data.folder._id}`, owner)
      .send({ name: 'Renamed parent' });
    expect(rename.status).toBe(200);
    const move = await authenticated('post', `/api/v1/folders/${child.body.data.folder._id}/move`, owner)
      .send({ parentId: parentTwo.body.data.folder._id });
    expect(move.status).toBe(200);
    const cycle = await authenticated('post', `/api/v1/folders/${parentTwo.body.data.folder._id}/move`, owner)
      .send({ parentId: child.body.data.folder._id });
    expect(cycle.status).toBe(409);
    expect(cycle.body.error.code).toBe('FOLDER_INVALID_HIERARCHY');

    const viewerRole = await authenticated('patch', `/api/v1/organizations/${organizationId}/members/${memberId}`, owner)
      .send({ role: 'VIEWER' });
    expect(viewerRole.status).toBe(200);
    const viewerCreate = await authenticated('post', '/api/v1/folders', member)
      .send({ name: 'Viewer cannot create', workspaceId: organizationId });
    expect(viewerCreate.status).toBe(403);
    const viewerUpload = await authenticated('post', '/api/v1/files/upload', member)
      .field('workspaceId', organizationId)
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'viewer.pdf');
    expect(viewerUpload.status).toBe(403);

    const adminRole = await authenticated('patch', `/api/v1/organizations/${organizationId}/members/${memberId}`, owner)
      .send({ role: 'ADMIN' });
    expect(adminRole.status).toBe(200);
    const adminCreate = await authenticated('post', '/api/v1/folders', member)
      .send({ name: 'Admin-created shared folder', workspaceId: organizationId });
    expect(adminCreate.status).toBe(201);

    const removed = await authenticated('delete', `/api/v1/organizations/${organizationId}/members/${memberId}`, owner);
    expect(removed.status).toBe(204);
    const removedAccess = await authenticated('get', '/api/v1/folders', member);
    expect(removedAccess.body.data.folders.some((item: { _id: string }) => item._id === sharedFolder.body.data.folder._id)).toBe(false);
    expect(await models.AuditLog.exists({ actorId: owner.id, action: 'MEMBER_INVITED' })).not.toBeNull();
    expect(await models.Notification.exists({ userId: member.id, type: 'WORKSPACE_INVITATION' })).not.toBeNull();
  }, 60_000);

  it('enforces cross-user file and share ownership and persists wrong-password security events', async () => {
    const owner = await login(await signup());
    const otherUser = await login(await signup());
    const file = await models.FileRecord.create({
      ownerId: owner.id,
      originalFilename: 'private.pdf',
      displayName: 'private.pdf',
      storageKey: `integration/${crypto.randomUUID()}`,
      mimeType: 'application/pdf',
      size: 16,
      sha256: 'a'.repeat(64),
      securityStatus: 'CLEAN'
    });
    createdFileIds.add(file.id);

    const metadata = await authenticated('get', `/api/v1/files/${file.id}`, otherUser);
    const download = await authenticated('post', `/api/v1/files/${file.id}/download`, otherUser);
    const deletion = await authenticated('delete', `/api/v1/files/${file.id}`, otherUser);
    const versions = await authenticated('get', `/api/v1/files/${file.id}/versions`, otherUser);
    for (const response of [metadata, download, deletion, versions]) expect([403, 404]).toContain(response.status);

    const { default: argon2 } = await import('argon2');
    const token = `integration-share-${crypto.randomUUID()}`;
    const share = await models.Share.create({
      tokenHash: (await import('@cloudvault/security')).sha256(token),
      fileId: file.id,
      ownerId: owner.id,
      passwordHash: await argon2.hash('correct-password'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      maxDownloads: 1
    });
    createdShareIds.add(share.id);
    const requestId = `cv-it-${crypto.randomUUID()}`;
    securityRequestIds.add(requestId);
    const shareIp = nextTestIp();
    const badPassword = await request(app)
      .post(`/api/v1/shares/${token}/access`)
      .set('X-Forwarded-For', shareIp)
      .set('X-Request-ID', requestId)
      .send({ password: 'wrong-password', intent: 'download' });
    expect(badPassword.status).toBe(401);
    expect(badPassword.body.error.code).toBe('SHARE_INVALID_PASSWORD');
    expect(await models.ShareAccessEvent.exists({ shareId: share.id, outcome: 'PASSWORD_FAILED' })).not.toBeNull();
    expect(await models.SecurityEvent.exists({ requestId, type: 'SHARE_BRUTE_FORCE' })).not.toBeNull();

    const revoke = await authenticated('post', `/api/v1/shares/${share.id}/revoke`, otherUser);
    expect([403, 404]).toContain(revoke.status);
  }, 60_000);

  it('enforces the authentication rate limit through the live Redis store', async () => {
    const ip = nextTestIp();
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await request(app)
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', ip)
        .send({}));
    }
    expect(responses.slice(0, 10).every((response) => response.status === 422)).toBe(true);
    expect(responses[10]?.status).toBe(429);
    expect(responses[10]?.body.error.code).toBe('RATE_LIMITED');
  }, 30_000);

  it.skipIf(!minioIntegrationEnabled)('uploads and downloads a real private MinIO PDF and consumes concurrent secure-share limits atomically', async () => {
    const { createHash } = await import('node:crypto');
    const { Client } = await import('minio');
    const { getConfig } = await import('@cloudvault/config');
    const { storage } = await import('./storage.service');
    const owner = await login(await signup());
    const otherUser = await login(await signup());
    await storage.ensureBucket();

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    const uploaded = await authenticated('post', '/api/v1/files/upload', owner)
      .attach('file', pdf, 'private-verification.pdf');
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.data.file._id as string;
    createdFileIds.add(fileId);
    const file = await models.FileRecord.findById(fileId).select('+storageKey');
    expect(file).not.toBeNull();
    if (!file) throw new Error('The uploaded MongoDB file record was not found.');
    createdStorageKeys.add(file.storageKey);
    expect(file.securityStatus).toBe('SCAN_PENDING');
    expect(file.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect((await storage.getMetadata(file.storageKey)).size).toBe(pdf.length);

    const config = getConfig();
    const anonymousMinio = new Client({
      endPoint: config.MINIO_ENDPOINT,
      port: config.MINIO_PORT,
      useSSL: config.MINIO_USE_SSL,
      accessKey: 'invalid-anonymous-user',
      secretKey: 'invalid-anonymous-secret'
    });
    await expect(anonymousMinio.statObject(config.MINIO_BUCKET, file.storageKey)).rejects.toBeTruthy();

    const unauthorized = await authenticated('get', `/api/v1/files/${fileId}/content`, otherUser);
    expect([403, 404]).toContain(unauthorized.status);
    const pending = await authenticated('get', `/api/v1/files/${fileId}/content`, owner);
    expect(pending.status).toBe(423);

    const scanDeadline = Date.now() + 90_000;
    let scanStatus = file.securityStatus;
    while (Date.now() < scanDeadline && (scanStatus === 'SCAN_PENDING' || scanStatus === 'SCANNING')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      scanStatus = (await models.FileRecord.findById(fileId))?.securityStatus ?? 'SCAN_FAILED';
    }
    expect(scanStatus).toBe('CLEAN');

    const downloaded = await binaryResponse(authenticated('get', `/api/v1/files/${fileId}/content`, owner));
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(downloaded.body)).toEqual(pdf);
    const userB = await binaryResponse(authenticated('get', `/api/v1/files/${fileId}/content`, otherUser));
    expect([403, 404]).toContain(userB.status);

    const makeShare = async (options: Record<string, unknown>) => {
      const response = await authenticated('post', '/api/v1/shares', owner)
        .send({ fileId, expiresInHours: 24, ...options });
      expect(response.status).toBe(201);
      const shareId = response.body.data.share._id as string;
      createdShareIds.add(shareId);
      return { id: shareId, token: response.body.data.token as string };
    };

    const passwordShare = await makeShare({
      password: 'share-password-123',
      maxDownloads: 1,
      recipientEmail: otherUser.email,
      requireAuthentication: true
    });
    const anonymousDenied = await request(app)
      .post(`/api/v1/shares/${passwordShare.token}/content`)
      .set('X-Forwarded-For', nextTestIp())
      .send({ password: 'share-password-123', intent: 'download' });
    expect(anonymousDenied.status).toBe(401);

    const wrongPassword = await authenticated('post', `/api/v1/shares/${passwordShare.token}/content`, otherUser)
      .send({ password: 'not-the-password', intent: 'download' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('SHARE_INVALID_PASSWORD');

    const correctPassword = await binaryResponse(authenticated('post', `/api/v1/shares/${passwordShare.token}/content`, otherUser)
      .send({ password: 'share-password-123', intent: 'download' }));
    expect(correctPassword.status).toBe(200);
    expect(Buffer.from(correctPassword.body)).toEqual(pdf);
    const exhausted = await authenticated('post', `/api/v1/shares/${passwordShare.token}/content`, otherUser)
      .send({ password: 'share-password-123', intent: 'download' });
    expect(exhausted.status).toBe(410);

    const expiredShare = await makeShare({});
    await models.Share.updateOne({ _id: expiredShare.id }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    const expired = await request(app)
      .post(`/api/v1/shares/${expiredShare.token}/content`)
      .set('X-Forwarded-For', nextTestIp())
      .send({ intent: 'download' });
    expect(expired.status).toBe(410);

    const revokedShare = await makeShare({});
    expect((await authenticated('post', `/api/v1/shares/${revokedShare.id}/revoke`, owner)).status).toBe(200);
    const revoked = await request(app)
      .post(`/api/v1/shares/${revokedShare.token}/content`)
      .set('X-Forwarded-For', nextTestIp())
      .send({ intent: 'download' });
    expect(revoked.status).toBe(410);

    const limitedShare = await makeShare({ maxDownloads: 1 });
    const simultaneousDownloads = await Promise.all(Array.from({ length: 12 }, async () =>
      binaryResponse(request(app)
        .post(`/api/v1/shares/${limitedShare.token}/content`)
        .set('X-Forwarded-For', nextTestIp())
        .send({ intent: 'download' }))
    ));
    expect(simultaneousDownloads.filter((response) => response.status === 200)).toHaveLength(1);

    const oneTimeShare = await makeShare({ oneTime: true });
    const simultaneousOneTime = await Promise.all(Array.from({ length: 12 }, async () =>
      binaryResponse(request(app)
        .post(`/api/v1/shares/${oneTimeShare.token}/content`)
        .set('X-Forwarded-For', nextTestIp())
        .send({ intent: 'preview' }))
    ));
    expect(simultaneousOneTime.filter((response) => response.status === 200)).toHaveLength(1);

    expect(await models.Notification.exists({ userId: owner.id, type: 'SHARE_ACCESSED' })).not.toBeNull();
    expect(await models.AuditLog.exists({ actorId: owner.id, action: 'FILE_DOWNLOADED', resourceId: fileId })).not.toBeNull();
    expect(await models.ShareAccessEvent.exists({ shareId: passwordShare.id, outcome: 'SUCCESS' })).not.toBeNull();
  }, 150_000);

  it('persists test-created user data across a database disconnect and reconnect', async () => {
    const account = await signup();
    await mongooseModule.disconnect();
    await database.connectDatabase();
    expect(await models.User.exists({ _id: account.id, email: account.email })).not.toBeNull();
  }, 30_000);
});
