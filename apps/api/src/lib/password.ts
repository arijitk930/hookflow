import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with Argon2id (memory-hard, prebuilt native binding).
 *
 * Parameters follow the OWASP minimum: 19 MiB memory, 2 iterations, 1 lane.
 * They are encoded in the stored hash (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`),
 * so they can be raised later without invalidating existing passwords.
 */
const ARGON2_OPTIONS = {
  // Algorithm.Argon2id; the library's const enum can't be imported with isolatedModules
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    // Malformed or unsupported stored hash
    return false;
  }
}

/**
 * Hash of a random password, verified against when a login email doesn't exist,
 * so "unknown email" and "wrong password" take the same time.
 */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(32).toString("hex"));
