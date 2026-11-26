import type { SessionUser } from "../auth/session.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth for authenticated dashboard requests. */
      user?: SessionUser;
      sessionId?: string;
      /** Set by requireApiKey for event ingestion requests. */
      apiKey?: { id: string; userId: string };
    }
  }
}

export {};
