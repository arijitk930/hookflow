import { rateLimit, type Options } from "express-rate-limit";
import type { ApiError } from "@hookflow/shared";

/**
 * Rate limiter with HookFlow's error shape. Counters are held in memory, so limits
 * apply per API process; a shared Redis store is needed before running several.
 */
export function createRateLimiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      const payload: ApiError = {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Too many requests, please try again later" },
      };
      res.status(429).json(payload);
    },
    ...options,
  });
}
