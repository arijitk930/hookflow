import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { createTestUsers } from "../test/helpers.js";

const app = createApp({ authRateLimitMax: 1000 });
const users = createTestUsers(app);

/** A signed-in user with an ingestion API key. */
async function setup() {
  const user = await users.signUp();
  const res = await request(app)
    .post("/api/v1/api-keys")
    .set("Cookie", user.cookie)
    .send({ name: "ingest" });
  return { ...user, key: res.body.data.rawKey as string, keyId: res.body.data.id as string };
}

/** Inserted directly: endpoint URL checks are covered by the endpoint tests. */
function addEndpoint(
  userId: string,
  eventTypes: string[],
  extra: { isActive?: boolean; deletedAt?: Date } = {}
) {
  return prisma.endpoint.create({
    data: {
      userId,
      name: "receiver",
      url: "https://hooks.example.com/",
      eventTypes,
      signingSecretEncrypted: "x",
      ...extra,
    },
  });
}

function ingest(key: string, body: object, idempotencyKey?: string, target: Express = app) {
  const req = request(target).post("/api/v1/events").set("Authorization", `Bearer ${key}`);
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  return req.send(body);
}

const order = { type: "order.created", data: { orderId: "ord_123", amount: 1499, currency: "INR" } };

describe("Events API", () => {
  afterAll(async () => {
    await users.cleanup();
    await prisma.$disconnect();
  });

  describe("POST /api/v1/events", () => {
    it("accepts an event and creates one pending delivery per matching active endpoint", async () => {
      const user = await setup();
      const other = await setup();
      const a = await addEndpoint(user.id, ["order.created"]);
      const b = await addEndpoint(user.id, ["user.registered", "order.created"]);
      await addEndpoint(user.id, ["order.paid"]); // different type
      await addEndpoint(user.id, ["order.created"], { isActive: false });
      await addEndpoint(user.id, ["order.created"], { deletedAt: new Date() });
      await addEndpoint(other.id, ["order.created"]); // someone else's

      const res = await ingest(user.key, order);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        ok: true,
        data: {
          id: expect.any(String),
          type: "order.created",
          status: "accepted",
          deliveriesCreated: 2,
          createdAt: expect.any(String),
        },
      });

      const event = await prisma.event.findUniqueOrThrow({
        where: { id: res.body.data.id },
        include: { deliveries: true },
      });
      expect(event.userId).toBe(user.id);
      expect(event.payload).toEqual(order.data);
      expect(event.deliveries.map((d) => d.endpointId).sort()).toEqual([a.id, b.id].sort());
      for (const delivery of event.deliveries) {
        expect(delivery).toMatchObject({ status: "PENDING", attemptCount: 0, maxAttempts: 5 });
        expect(delivery.nextAttemptAt).not.toBeNull();
      }
    });

    it("accepts an event with no subscribers", async () => {
      const user = await setup();
      const res = await ingest(user.key, order);
      expect(res.status).toBe(202);
      expect(res.body.data.deliveriesCreated).toBe(0);
    });

    it("returns the original event for a repeated idempotency key without new work", async () => {
      const user = await setup();
      await addEndpoint(user.id, ["order.created"]);
      const key = "order-123-created-v1";

      const first = await ingest(user.key, order, key);
      // An endpoint added later must not receive the replayed event
      await addEndpoint(user.id, ["order.created"]);
      const second = await ingest(user.key, { ...order, data: { changed: true } }, key);

      expect(first.headers["idempotent-replayed"]).toBeUndefined();
      expect(second.status).toBe(202);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.body).toEqual(first.body);
      expect(await prisma.event.count({ where: { userId: user.id } })).toBe(1);
      expect(await prisma.delivery.count({ where: { event: { userId: user.id } } })).toBe(1);
    });

    it("creates exactly one event when identical requests race", async () => {
      const user = await setup();
      await addEndpoint(user.id, ["order.created"]);
      const key = randomUUID();

      const results = await Promise.all(Array.from({ length: 5 }, () => ingest(user.key, order, key)));

      expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await prisma.event.count({ where: { userId: user.id } })).toBe(1);
      expect(await prisma.delivery.count({ where: { event: { userId: user.id } } })).toBe(1);
    });

    it("scopes idempotency keys to the user, and treats no key as always new", async () => {
      const alice = await setup();
      const bob = await setup();

      const a = await ingest(alice.key, order, "shared-key");
      const b = await ingest(bob.key, order, "shared-key");
      expect(b.body.data.id).not.toBe(a.body.data.id);

      const one = await ingest(alice.key, order);
      const two = await ingest(alice.key, order);
      expect(two.body.data.id).not.toBe(one.body.data.id);
    });

    it("rejects missing and revoked API keys, and session cookies", async () => {
      const user = await setup();
      await request(app).delete(`/api/v1/api-keys/${user.keyId}`).set("Cookie", user.cookie);

      for (const res of [
        await request(app).post("/api/v1/events").send(order),
        await ingest(user.key, order),
        await request(app).post("/api/v1/events").set("Cookie", user.cookie).send(order),
      ]) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("INVALID_API_KEY");
      }
      expect(await prisma.event.count({ where: { userId: user.id } })).toBe(0);
    });

    it("validates the body, idempotency key and content type", async () => {
      const user = await setup();

      const bodies: object[] = [
        { data: {} },
        { type: "Order Created", data: {} },
        { type: "order.created" },
        { type: "order.created", data: [1, 2] },
        { type: "order.created", data: "text" },
        { ...order, userId: "someone-else" },
        { type: "order.created", data: { note: "a\u0000b" } },
      ];
      for (const body of bodies) {
        const res = await ingest(user.key, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }

      expect((await ingest(user.key, order, "k".repeat(256))).status).toBe(400);

      const form = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${user.key}`)
        .type("form")
        .send("type=order.created");
      expect(form.status).toBe(415);

      expect(await prisma.event.count({ where: { userId: user.id } })).toBe(0);
    });

    it("enforces the payload size limit", async () => {
      const user = await setup();
      const res = await ingest(user.key, {
        type: "order.created",
        data: { blob: "x".repeat(config.EVENT_MAX_BYTES) },
      });
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("rate-limits per account, across that account's keys", async () => {
      const limited = createApp({ authRateLimitMax: 1000, eventRateLimit: 2 });
      const user = await setup();
      const secondKey = (
        await request(app).post("/api/v1/api-keys").set("Cookie", user.cookie).send({ name: "2" })
      ).body.data.rawKey;
      const other = await setup();

      expect((await ingest(user.key, order, undefined, limited)).status).toBe(202);
      expect((await ingest(secondKey, order, undefined, limited)).status).toBe(202);
      const blocked = await ingest(user.key, order, undefined, limited);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect((await ingest(other.key, order, undefined, limited)).status).toBe(202);
    });

    it("limits repeated bad keys by IP without counting successful requests", async () => {
      const limited = createApp({ authRateLimitMax: 1000, ingestAuthFailureLimit: 2 });
      const user = await setup();
      const bad = "hf_live_" + "A".repeat(43);

      for (let i = 0; i < 3; i++) {
        expect((await ingest(user.key, order, undefined, limited)).status).toBe(202);
      }
      expect((await ingest(bad, order, undefined, limited)).status).toBe(401);
      expect((await ingest(bad, order, undefined, limited)).status).toBe(401);
      expect((await ingest(bad, order, undefined, limited)).status).toBe(429);
    });
  });

  describe("dashboard reads", () => {
    it("requires a session; an API key is not enough", async () => {
      const user = await setup();
      for (const path of ["/api/v1/events", "/api/v1/events/some-id"]) {
        const res = await request(app).get(path).set("Authorization", `Bearer ${user.key}`);
        expect(res.status).toBe(401);
      }
    });

    it("lists newest first, with pagination and filters, without payloads", async () => {
      const user = await setup();
      const ids: string[] = [];
      for (const type of ["order.created", "order.paid", "order.created"]) {
        ids.push((await ingest(user.key, { type, data: {} })).body.data.id);
      }
      const list = (query: string) =>
        request(app).get(`/api/v1/events${query}`).set("Cookie", user.cookie);

      const page1 = await list("?limit=2");
      expect(page1.body.data.items.map((e: { id: string }) => e.id)).toEqual([ids[2], ids[1]]);
      expect(page1.body.data.items[0]).not.toHaveProperty("payload");
      expect(page1.body.data.nextCursor).toBe(ids[1]);

      const page2 = await list(`?limit=2&cursor=${page1.body.data.nextCursor}`);
      expect(page2.body.data.items.map((e: { id: string }) => e.id)).toEqual([ids[0]]);
      expect(page2.body.data.nextCursor).toBeNull();

      const paid = await list("?type=order.paid");
      expect(paid.body.data.items.map((e: { id: string }) => e.id)).toEqual([ids[1]]);

      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect((await list(`?from=${future}`)).body.data.items).toEqual([]);
      expect((await list(`?to=${future}`)).body.data.items).toHaveLength(3);

      for (const bad of ["?limit=0", "?limit=101", "?from=yesterday", "?cursor=nope", "?userId=x"]) {
        expect((await list(bad)).status, bad).toBe(400);
      }
    });

    it("shows detail with payload and deliveries, including deleted endpoints", async () => {
      const user = await setup();
      const endpoint = await addEndpoint(user.id, ["order.created"]);
      const { id } = (await ingest(user.key, order)).body.data;
      await prisma.endpoint.update({ where: { id: endpoint.id }, data: { deletedAt: new Date() } });

      const res = await request(app).get(`/api/v1/events/${id}`).set("Cookie", user.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.payload).toEqual(order.data);
      expect(res.body.data.deliveries).toEqual([
        expect.objectContaining({
          endpointId: endpoint.id,
          endpointName: "receiver",
          endpointDeleted: true,
          status: "PENDING",
        }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain("signingSecret");
    });

    it("never exposes another user's events", async () => {
      const alice = await setup();
      const bob = await setup();
      const { id } = (await ingest(alice.key, order)).body.data;

      const detail = await request(app).get(`/api/v1/events/${id}`).set("Cookie", bob.cookie);
      expect(detail.status).toBe(404);
      const list = await request(app).get("/api/v1/events").set("Cookie", bob.cookie);
      expect(list.body.data.items).toEqual([]);
      const cursor = await request(app).get(`/api/v1/events?cursor=${id}`).set("Cookie", bob.cookie);
      expect(cursor.status).toBe(400);
    });
  });
});
