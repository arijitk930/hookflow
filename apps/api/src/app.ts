import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { ApiError } from "@hookflow/shared";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export interface AppOptions {
  /** Override AUTH_RATE_LIMIT_MAX (used by tests). */
  authRateLimitMax?: number;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.use(helmet());
  // Only the dashboard may call the API with cookies
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.authRateLimitMax ?? config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      const payload: ApiError = {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Too many attempts, please try again later" },
      };
      res.status(429).json(payload);
    },
  });

  // API v1 routes
  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", createAuthRouter(authRateLimiter));

  // 404 & Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app: Express = createApp();
