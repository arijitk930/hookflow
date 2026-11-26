import type { RequestHandler } from "express";
import { AppError } from "./errorHandler.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth, on top of SameSite cookies and narrow CORS.
 *
 * Browsers always send `Origin` on cross-origin state-changing requests, so a
 * request whose Origin isn't the dashboard is rejected before it runs. Requests
 * without an Origin (servers sending events, curl) are not browser-forged and pass.
 */
export function requireTrustedOrigin(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get("origin");
    if (!SAFE_METHODS.has(req.method) && origin !== undefined && origin !== allowedOrigin) {
      next(new AppError(403, "UNTRUSTED_ORIGIN", "Request origin is not allowed"));
      return;
    }
    next();
  };
}
