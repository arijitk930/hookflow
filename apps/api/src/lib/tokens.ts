import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export const API_KEY_PREFIX = "hf_live_";
/** hf_live_ + 43 base64url chars (32 random bytes) */
export const API_KEY_PATTERN = /^hf_live_[A-Za-z0-9_-]{43}$/;

/**
 * Creates a new ingestion API key. Returns the raw key (shown to the user once)
 * and a short display prefix like "hf_live_Ab3d" that is safe to store and show.
 */
export function generateApiKey(): { rawKey: string; displayPrefix: string } {
  const rawKey = API_KEY_PREFIX + generateToken();
  return { rawKey, displayPrefix: rawKey.slice(0, API_KEY_PREFIX.length + 4) };
}

/** Secret a receiver uses to verify webhook signatures. Stored encrypted, not hashed. */
export function generateSigningSecret(): string {
  return "whsec_" + generateToken();
}

/**
 * SHA-256 of a high-entropy token (session tokens, API keys).
 * A fast hash is safe here because the input is random, not a guessable password,
 * and it lets us look the token up by an indexed unique column.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
