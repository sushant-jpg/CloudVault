import type { AuthenticatedUser } from '@cloudvault/types';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthenticatedUser;
    }
  }
}

export {};
