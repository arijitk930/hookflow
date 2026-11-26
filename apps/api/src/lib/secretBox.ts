import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Authenticated encryption (AES-256-GCM) for secrets that must be read back,
 * such as endpoint signing secrets. The key comes from ENCRYPTION_KEY, never the DB.
 *
 * Stored format: `v1.<iv>.<authTag>.<ciphertext>` (base64url parts). The version
 * prefix leaves room for key rotation. `context` (the owning row's id) is bound as
 * additional authenticated data, so a ciphertext copied to another row won't decrypt.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const key = Buffer.from(config.ENCRYPTION_KEY, "hex");

export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Throws if the value is malformed, was tampered with, or belongs to another context. */
export function decryptSecret(stored: string, context: string): string {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unsupported encrypted secret format");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), {
    // Without this, GCM would accept a truncated (forgeable) tag
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
