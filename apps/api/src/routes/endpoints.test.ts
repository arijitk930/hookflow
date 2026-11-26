import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { createApp } from "../app.js";
import { decryptSecret } from "../lib/secretBox.js";
import { createTestUsers } from "../test/helpers.js";
import { MAX_ENDPOINTS_PER_USER } from "../services/endpoints.js";

// No real DNS in tests: names containing "private" resolve to an internal address
const app = createApp({
  authRateLimitMax: 1000,
  resolveHost: async (host) => [host.includes("private") ? "10.0.0.5" : "93.184.215.14"],
});
const users = createTestUsers(app);

const valid = {
  name: "Order service",
  url: "https://hooks.example.com/orders",
  eventTypes: ["order.created", "order.paid"],
};

function create(cookie: string, body: object = valid) {
  return request(app).post("/api/v1/endpoints").set("Cookie", cookie).send(body);
}

async function secretInDb(id: string): Promise<string> {
  return (await prisma.endpoint.findUniqueOrThrow({ where: { id } })).signingSecretEncrypted;
}

describe("Endpoints API", () => {
  afterAll(async () => {
    await users.cleanup();
    await prisma.$disconnect();
  });

  it("requires a dashboard session", async () => {
    for (const res of [
      await request(app).get("/api/v1/endpoints"),
      await request(app).post("/api/v1/endpoints").send(valid),
      await request(app).delete("/api/v1/endpoints/x"),
      await request(app).post("/api/v1/endpoints/x/rotate-secret"),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it("creates an endpoint, reveals the secret once and stores it encrypted", async () => {
    const user = await users.signUp();
    const res = await create(user.cookie, {
      ...valid,
      eventTypes: ["order.created", "order.created", "order.paid"],
    });

    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { signingSecret, ...endpoint } = res.body.data;
    expect(signingSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(endpoint).toEqual({
      id: expect.any(String),
      ...valid,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const stored = await secretInDb(endpoint.id);
    expect(stored).not.toContain(signingSecret);
    expect(decryptSecret(stored, endpoint.id)).toBe(signingSecret);

    // Neither the secret nor its ciphertext appears in later reads
    for (const path of ["/api/v1/endpoints", `/api/v1/endpoints/${endpoint.id}`]) {
      const read = await request(app).get(path).set("Cookie", user.cookie);
      expect(read.status).toBe(200);
      expect(JSON.stringify(read.body)).not.toContain(signingSecret);
      expect(JSON.stringify(read.body)).not.toContain("signingSecret");
    }
  });

  it("validates input and rejects unknown fields", async () => {
    const user = await users.signUp();
    const other = await users.signUp();

    const cases: object[] = [
      { ...valid, name: " " },
      { ...valid, eventTypes: [] },
      { ...valid, eventTypes: ["Order Created"] },
      { ...valid, eventTypes: ["order..created"] },
      { ...valid, userId: other.id },
      { name: "missing url", eventTypes: ["a.b"] },
    ];
    for (const body of cases) {
      const res = await create(user.cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.endpoint.count({ where: { userId: { in: [user.id, other.id] } } })).toBe(0);
  });

  it("rejects unsafe URLs on create and update without saving them", async () => {
    const user = await users.signUp();
    const unsafe = [
      "http://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://private.example.com/hook",
    ];

    for (const url of unsafe) {
      const res = await create(user.cookie, { ...valid, url });
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe("INVALID_ENDPOINT_URL");
      expect(res.body.error.details).toHaveProperty("url");
      expect(JSON.stringify(res.body)).not.toContain("10.0.0.5");
    }

    const { id } = (await create(user.cookie)).body.data;
    for (const url of unsafe) {
      const res = await request(app)
        .patch(`/api/v1/endpoints/${id}`)
        .set("Cookie", user.cookie)
        .send({ url });
      expect(res.status, url).toBe(400);
    }
    const row = await prisma.endpoint.findUniqueOrThrow({ where: { id } });
    expect(row.url).toBe(valid.url);
  });

  it("updates fields and toggles active state", async () => {
    const user = await users.signUp();
    const { id } = (await create(user.cookie)).body.data;
    const secretBefore = await secretInDb(id);

    const res = await request(app)
      .patch(`/api/v1/endpoints/${id}`)
      .set("Cookie", user.cookie)
      .send({ name: "Renamed", isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Renamed", isActive: false, url: valid.url });
    expect(await secretInDb(id)).toBe(secretBefore);

    for (const body of [{}, { deletedAt: null }, { signingSecretEncrypted: "x" }]) {
      const bad = await request(app)
        .patch(`/api/v1/endpoints/${id}`)
        .set("Cookie", user.cookie)
        .send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rotates the signing secret", async () => {
    const user = await users.signUp();
    const created = (await create(user.cookie)).body.data;

    const res = await request(app)
      .post(`/api/v1/endpoints/${created.id}/rotate-secret`)
      .set("Cookie", user.cookie);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data.signingSecret).not.toBe(created.signingSecret);
    expect(decryptSecret(await secretInDb(created.id), created.id)).toBe(
      res.body.data.signingSecret
    );
  });

  it("hides another user's endpoint from every operation", async () => {
    const alice = await users.signUp();
    const bob = await users.signUp();
    const { id } = (await create(alice.cookie)).body.data;
    const before = await prisma.endpoint.findUniqueOrThrow({ where: { id } });
    const path = `/api/v1/endpoints/${id}`;

    for (const res of [
      await request(app).get(path).set("Cookie", bob.cookie),
      await request(app).patch(path).set("Cookie", bob.cookie).send({ name: "stolen" }),
      await request(app).delete(path).set("Cookie", bob.cookie),
      await request(app).post(`${path}/rotate-secret`).set("Cookie", bob.cookie),
    ]) {
      expect(res.status).toBe(404);
    }

    expect((await request(app).get("/api/v1/endpoints").set("Cookie", bob.cookie)).body.data).toEqual([]);
    expect(await prisma.endpoint.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });

  it("soft-deletes: gone from the API, row kept, secret discarded", async () => {
    const user = await users.signUp();
    const { id } = (await create(user.cookie)).body.data;
    const path = `/api/v1/endpoints/${id}`;

    expect((await request(app).delete(path).set("Cookie", user.cookie)).status).toBe(204);

    const row = await prisma.endpoint.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
    expect(row.signingSecretEncrypted).toBe("");

    for (const res of [
      await request(app).get(path).set("Cookie", user.cookie),
      await request(app).patch(path).set("Cookie", user.cookie).send({ isActive: true }),
      await request(app).delete(path).set("Cookie", user.cookie),
      await request(app).post(`${path}/rotate-secret`).set("Cookie", user.cookie),
    ]) {
      expect(res.status).toBe(404);
    }
    const list = await request(app).get("/api/v1/endpoints").set("Cookie", user.cookie);
    expect(list.body.data).toEqual([]);
  });

  it(`caps endpoints at ${MAX_ENDPOINTS_PER_USER}, not counting deleted ones`, async () => {
    const user = await users.signUp();
    const row = { userId: user.id, ...valid, signingSecretEncrypted: "x" };
    await prisma.endpoint.createMany({
      data: Array.from({ length: MAX_ENDPOINTS_PER_USER }, () => row),
    });

    const over = await create(user.cookie);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("ENDPOINT_LIMIT_REACHED");

    const one = await prisma.endpoint.findFirstOrThrow({ where: { userId: user.id } });
    await request(app).delete(`/api/v1/endpoints/${one.id}`).set("Cookie", user.cookie);
    expect((await create(user.cookie)).status).toBe(201);
  });
});
