import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { createTestUsers } from "../test/helpers.js";

const app = createApp({ authRateLimitMax: 1000 });
const users = createTestUsers(app);

describe("request guards", () => {
  afterAll(async () => {
    await users.cleanup();
    await prisma.$disconnect();
  });

  it("returns 413 for an oversized body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@hookflow.test", password: "x".repeat(1_100_000) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("still returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("blocks state-changing requests from another origin, without running them", async () => {
    const user = await users.signUp();

    for (const origin of ["https://evil.example", "http://localhost:9999", "null"]) {
      const res = await request(app)
        .post("/api/v1/auth/logout")
        .set("Cookie", user.cookie)
        .set("Origin", origin);
      expect(res.status, origin).toBe(403);
      expect(res.body.error.code).toBe("UNTRUSTED_ORIGIN");
    }

    // The session survived every forged logout
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", user.cookie);
    expect(me.status).toBe(200);
  });

  it("allows the dashboard origin and non-browser clients", async () => {
    const dashboard = await users.signUp();
    const fromDashboard = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", dashboard.cookie)
      .set("Origin", config.WEB_ORIGIN);
    expect(fromDashboard.status).toBe(204);

    const script = await users.signUp();
    const noOrigin = await request(app).post("/api/v1/auth/logout").set("Cookie", script.cookie);
    expect(noOrigin.status).toBe(204);
  });
});
