import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { getConfig } from '@cloudvault/config';
import { auditRouter } from './routes/audit.routes';
import { adminRouter } from './routes/admin.routes';
import { authRouter } from './routes/auth.routes';
import { fileRouter } from './routes/file.routes';
import { folderRouter } from './routes/folder.routes';
import { notificationRouter } from './routes/notification.routes';
import { organizationRouter } from './routes/organization.routes';
import { securityRouter } from './routes/security.routes';
import { shareRouter } from './routes/share.routes';
import { userRouter } from './routes/user.routes';
import { errorHandler, notFound } from './middleware/error-handler';
import { requestContext } from './middleware/request-context';
import { databaseReady } from './lib/database';
import { logger } from './lib/logger';
import { redisReady } from './lib/redis';
import { storage } from './services/storage.service';
import { openApiDocument } from './openapi';

export const createApp = () => {
  const app = express();
  const config = getConfig();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(pinoHttp({
    logger,
    customProps: (req) => ({ requestId: req.id }),
    serializers: {
      req: (req) => {
        const serialized = pino.stdSerializers.req(req);
        return {
          ...serialized,
          url: typeof serialized.url === 'string'
            ? serialized.url.replace(/(\/api\/v1\/shares\/)[^/?]+(\/access(?:\?|$))/, '$1[REDACTED]$2')
            : serialized.url
        };
      }
    }
  }));
  app.use(helmet({
    contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false,
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'no-referrer' }
  }));
  app.use(cors({ origin: config.WEB_URL, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'] }));
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'cloudvault-api' }));
  app.get('/health/ready', async (_req, res) => {
    const dependencies = { mongodb: databaseReady(), redis: redisReady(), objectStorage: await storage.ready() };
    const ready = Object.values(dependencies).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', dependencies });
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'CloudVault API' }));
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument));

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/sessions', authRouter);
  app.use('/api/v1/files', fileRouter);
  app.use('/api/v1/folders', folderRouter);
  app.use('/api/v1/shares', shareRouter);
  app.use('/api/v1/organizations', organizationRouter);
  app.use('/api/v1/notifications', notificationRouter);
  app.use('/api/v1/security', securityRouter);
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
};
