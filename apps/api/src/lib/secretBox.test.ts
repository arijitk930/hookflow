import { describe, it, expect } from "vitest";
import { decryptSecret, encryptSecret } from "./secretBox.js";

/** Flips one character in the given dot-separated part. */
function tamper(stored: string, part: number): string {
  const parts = stored.split(".");
  parts[part] = (parts[part]![0] === "A" ? "B" : "A") + parts[part]!.slice(1);
  return parts.join(".");
}

describe("secretBox (AES-256-GCM)", () => {
  const stored = encryptSecret("whsec_example", "endpoint-1");

  it("round-trips without storing the plaintext", () => {
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain("whsec_example");
    expect(decryptSecret(stored, "endpoint-1")).toBe("whsec_example");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("whsec_example", "endpoint-1")).not.toBe(stored);
  });

  it("rejects a ciphertext moved to another endpoint", () => {
    expect(() => decryptSecret(stored, "endpoint-2")).toThrow();
  });

  it("rejects tampering with the IV, tag or ciphertext", () => {
    for (const part of [1, 2, 3]) {
      expect(() => decryptSecret(tamper(stored, part), "endpoint-1"), `part ${part}`).toThrow();
    }
  });

  it("rejects a truncated auth tag and unknown formats", () => {
    const [v, iv, tag, data] = stored.split(".");
    const shortTag = Buffer.from(tag!, "base64url").subarray(0, 4).toString("base64url");

    expect(() => decryptSecret([v, iv, shortTag, data].join("."), "endpoint-1")).toThrow();
    expect(() => decryptSecret("v2.a.b.c", "endpoint-1")).toThrow();
    expect(() => decryptSecret("", "endpoint-1")).toThrow();
  });
});
