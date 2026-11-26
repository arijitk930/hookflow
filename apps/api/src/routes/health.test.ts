import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "@hookflow/db";
import { closeRedisClient } from "../redis.js";
import { closeStorageClient } from "../storage.js";

describe("Health Route & API foundation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await closeRedisClient();
    closeStorageClient();
  });

  it("GET /api/v1/health returns 200 with healthy services", async () => {
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe("healthy");
    expect(res.body.data.services.database).toBe("connected");
    expect(res.body.data.services.redis).toBe("connected");
    expect(res.body.data.services.storage).toBe("connected");
    expect(typeof res.body.data.uptime).toBe("number");
    expect(typeof res.body.data.timestamp).toBe("string");
  });

  it("GET /api/v1/unknown-route returns 404 with structured ApiError", async () => {
    const res = await request(app).get("/api/v1/unknown-route");

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toContain("/api/v1/unknown-route");
  });
});
