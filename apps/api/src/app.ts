import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { createEndpointsRouter } from "./routes/endpoints.js";
import { createEventsRouter } from "./routes/events.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import type { Resolver } from "./lib/ssrf.js";
import { requireTrustedOrigin } from "./middleware/requireTrustedOrigin.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export interface AppOptions {
  /** Override AUTH_RATE_LIMIT_MAX (used by tests). */
  authRateLimitMax?: number;
  /** Override EVENT_RATE_LIMIT_PER_MINUTE (used by tests). */
  eventRateLimit?: number;
  /** Override INGEST_AUTH_FAILURE_LIMIT (used by tests). */
  ingestAuthFailureLimit?: number;
  /** Override DNS resolution for endpoint URL checks (used by tests). */
  resolveHost?: Resolver;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.use(helmet());
  // Only the dashboard may call the API with cookies
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  // CSRF: reject state-changing browser requests from other origins
  app.use(requireTrustedOrigin(config.WEB_ORIGIN));
  app.use(cookieParser());

  // Mounted before the global body parser: ingestion authenticates first and
  // applies its own, smaller size limit
  app.use(
    "/api/v1/events",
    createEventsRouter({
      maxBytes: config.EVENT_MAX_BYTES,
      authFailureLimiter: createRateLimiter({
        windowMs: 15 * 60 * 1000,
        limit: options.ingestAuthFailureLimit ?? config.INGEST_AUTH_FAILURE_LIMIT,
        // Only rejected keys count against the caller's IP
        skipSuccessfulRequests: true,
        requestWasSuccessful: (_req, res) => res.statusCode !== 401,
      }),
      // Per account, so creating more API keys doesn't raise the limit
      ingestLimiter: createRateLimiter({
        windowMs: 60 * 1000,
        limit: options.eventRateLimit ?? config.EVENT_RATE_LIMIT_PER_MINUTE,
        keyGenerator: (req) => req.apiKey!.userId,
      }),
    })
  );

  app.use(express.json({ limit: "1mb" }));

  const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: options.authRateLimitMax ?? config.AUTH_RATE_LIMIT_MAX,
  });

  // API v1 routes
  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", createAuthRouter(authRateLimiter));
  app.use("/api/v1/api-keys", apiKeysRouter);
  app.use(
    "/api/v1/endpoints",
    createEndpointsRouter({
      allowHttp: config.NODE_ENV !== "production",
      allowedPrivateHosts: config.SSRF_ALLOWED_PRIVATE_HOSTS,
      resolve: options.resolveHost,
    })
  );

  // 404 & Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app: Express = createApp();
