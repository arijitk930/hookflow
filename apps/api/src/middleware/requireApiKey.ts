import type { RequestHandler } from "express";
import { prisma } from "@hookflow/db";
import { asyncHandler } from "../lib/asyncHandler.js";
import { API_KEY_PATTERN, hashToken } from "../lib/tokens.js";
import { AppError } from "./errorHandler.js";

/** Only write lastUsedAt when it is older than this, so hot keys don't write on every request. */
const LAST_USED_RESOLUTION_MS = 60 * 1000;

function invalidKey(): AppError {
  return new AppError(401, "INVALID_API_KEY", "Missing, invalid or revoked API key");
}

/**
 * Authenticates ingestion requests via `Authorization: Bearer hf_live_...`.
 * On success sets req.apiKey = { id, userId }. The raw key is never logged.
 */
export const requireApiKey: RequestHandler = asyncHandler(async (req, res, next) => {
  const [scheme, rawKey] = (req.get("authorization") ?? "").split(" ");

  // Reject malformed keys before touching the database
  if (scheme?.toLowerCase() !== "bearer" || !rawKey || !API_KEY_PATTERN.test(rawKey)) {
    res.set("WWW-Authenticate", "Bearer");
    throw invalidKey();
  }

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashToken(rawKey) },
    select: { id: true, userId: true, revokedAt: true, lastUsedAt: true },
  });

  if (!key || key.revokedAt) {
    res.set("WWW-Authenticate", "Bearer");
    throw invalidKey();
  }

  const now = new Date();
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
  }

  req.apiKey = { id: key.id, userId: key.userId };
  next();
});
