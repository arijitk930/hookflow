import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing (Argon2id)", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");

    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("salts every hash, so equal passwords produce different hashes", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$32768$8$1$abc$def")).toBe(false);
  });
});
