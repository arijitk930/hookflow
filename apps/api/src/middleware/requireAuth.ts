import type { RequestHandler } from "express";
import { SESSION_COOKIE, getSessionUser } from "../auth/session.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { AppError } from "./errorHandler.js";

/**
 * Requires a valid dashboard session cookie. On success sets req.user / req.sessionId;
 * every downstream query must scope by req.user.id.
 */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const session = typeof token === "string" && token ? await getSessionUser(token) : null;

  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
  }

  req.user = session.user;
  req.sessionId = session.sessionId;
  next();
});
