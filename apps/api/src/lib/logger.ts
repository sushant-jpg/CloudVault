import pino from 'pino';
import { getConfig } from '@cloudvault/config';

export const logger = pino({
  level: getConfig().LOG_LEVEL,
  base: { service: 'cloudvault-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret', '*.refreshToken'],
    censor: '[REDACTED]'
  }
});
