import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      /** The real admin when this request is a "view as" session. */
      impersonator?: User;
      mcpAuth?: boolean;
    }
  }
}

export {};
