import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 of a high-entropy token (session tokens, API keys).
 * A fast hash is safe here because the input is random, not a guessable password,
 * and it lets us look the token up by an indexed unique column.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
