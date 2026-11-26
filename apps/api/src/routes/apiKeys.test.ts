import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { createApp } from "../app.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { hashToken } from "../lib/tokens.js";
import { createTestUsers } from "../test/helpers.js";
import { MAX_ACTIVE_API_KEYS } from "./apiKeys.js";

const app = createApp({ authRateLimitMax: 1000 });
const users = createTestUsers(app);

/** Minimal app exercising requireApiKey the way the ingestion route will. */
const ingestApp = express();
ingestApp.get("/whoami", requireApiKey, (req, res) => {
  res.json(req.apiKey);
});
ingestApp.use(errorHandler);

async function createKey(cookie: string, name = "CI key") {
  return request(app).post("/api/v1/api-keys").set("Cookie", cookie).send({ name });
}

describe("API keys", () => {
  afterAll(async () => {
    await users.cleanup();
    await prisma.$disconnect();
  });

  it("requires a dashboard session", async () => {
    expect((await request(app).get("/api/v1/api-keys")).status).toBe(401);
    expect((await request(app).post("/api/v1/api-keys").send({ name: "x" })).status).toBe(401);
  });

  it("creates a key, reveals it once, and stores only its hash", async () => {
    const user = await users.signUp();
    const res = await createKey(user.cookie, "  Production  ");

    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { rawKey, ...meta } = res.body.data;
    expect(rawKey).toMatch(/^hf_live_[A-Za-z0-9_-]{43}$/);
    expect(meta).toEqual({
      id: expect.any(String),
      name: "Production",
      prefix: rawKey.slice(0, 12),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: expect.any(String),
    });

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: meta.id } });
    expect(row.keyHash).toBe(hashToken(rawKey));
    expect(JSON.stringify(row)).not.toContain(rawKey);

    // Never returned again
    const list = await request(app).get("/api/v1/api-keys").set("Cookie", user.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toEqual(meta);
    expect(JSON.stringify(list.body)).not.toContain(rawKey);
  });

  it("validates the name", async () => {
    const user = await users.signUp();
    const res = await createKey(user.cookie, "   ");
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty("name");
  });

  it("only lists and revokes the signed-in user's own keys", async () => {
    const alice = await users.signUp();
    const bob = await users.signUp();
    const aliceKey = (await createKey(alice.cookie)).body.data;

    const bobList = await request(app).get("/api/v1/api-keys").set("Cookie", bob.cookie);
    expect(bobList.body.data).toEqual([]);

    const bobRevoke = await request(app)
      .delete(`/api/v1/api-keys/${aliceKey.id}`)
      .set("Cookie", bob.cookie);
    expect(bobRevoke.status).toBe(404);

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: aliceKey.id } });
    expect(row.revokedAt).toBeNull();
  });

  it("revokes idempotently and keeps the original revokedAt", async () => {
    const user = await users.signUp();
    const key = (await createKey(user.cookie)).body.data;

    const first = await request(app).delete(`/api/v1/api-keys/${key.id}`).set("Cookie", user.cookie);
    expect(first.status).toBe(204);
    const { revokedAt } = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(revokedAt).not.toBeNull();

    const second = await request(app).delete(`/api/v1/api-keys/${key.id}`).set("Cookie", user.cookie);
    expect(second.status).toBe(204);
    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(after.revokedAt).toEqual(revokedAt);

    const list = await request(app).get("/api/v1/api-keys").set("Cookie", user.cookie);
    expect(list.body.data[0].revokedAt).toBe(revokedAt!.toISOString());
  });

  it(`caps active keys at ${MAX_ACTIVE_API_KEYS}; revoking frees a slot`, async () => {
    const user = await users.signUp();
    const ids: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_API_KEYS; i++) {
      ids.push((await createKey(user.cookie, `key ${i}`)).body.data.id);
    }

    const over = await createKey(user.cookie, "one too many");
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("API_KEY_LIMIT_REACHED");

    await request(app).delete(`/api/v1/api-keys/${ids[0]}`).set("Cookie", user.cookie);
    expect((await createKey(user.cookie, "replacement")).status).toBe(201);
  });

  describe("requireApiKey (ingestion auth)", () => {
    it("accepts a valid key and records lastUsedAt", async () => {
      const user = await users.signUp();
      const { rawKey, id } = (await createKey(user.cookie)).body.data;

      const res = await request(ingestApp).get("/whoami").set("Authorization", `Bearer ${rawKey}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, userId: user.id });

      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
      expect(row.lastUsedAt).not.toBeNull();
    });

    it("rejects missing, malformed, unknown and revoked keys with the same 401", async () => {
      const user = await users.signUp();
      const { rawKey, id } = (await createKey(user.cookie)).body.data;
      await request(app).delete(`/api/v1/api-keys/${id}`).set("Cookie", user.cookie);

      const unknownKey = "hf_live_" + "A".repeat(43);
      const cases = [
        undefined,
        "Bearer",
        "Basic dXNlcjpwYXNz",
        "Bearer not-a-key",
        `Bearer ${unknownKey}`,
        `Bearer ${rawKey}`, // revoked
      ];

      for (const header of cases) {
        const req = request(ingestApp).get("/whoami");
        const res = await (header ? req.set("Authorization", header) : req);
        expect(res.status, `Authorization: ${header}`).toBe(401);
        expect(res.body.error.code).toBe("INVALID_API_KEY");
        expect(res.headers["www-authenticate"]).toBe("Bearer");
      }
    });

    it("does not accept a session cookie in place of an API key", async () => {
      const user = await users.signUp();
      const res = await request(ingestApp).get("/whoami").set("Cookie", user.cookie);
      expect(res.status).toBe(401);
    });
  });
});
