import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node — no native deps).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`
 * The parameters live in the hash so they can be raised later without
 * invalidating existing passwords.
 */
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  // scrypt needs ~128 * N * r bytes; allow headroom over Node's 32 MiB default
  const maxmem = 256 * (opts.N ?? N) * (opts.r ?? r);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...opts, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, rr, pp, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Hash of a random password, verified against when a login email doesn't exist,
 * so "unknown email" and "wrong password" take the same time.
 */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(32).toString("hex"));
