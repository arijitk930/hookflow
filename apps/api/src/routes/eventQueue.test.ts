import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { createDeliveryProducer } from "@hookflow/queue";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { closeDeliveryProducer, getDeliveryProducer } from "../queue.js";
import { createTestUsers } from "../test/helpers.js";

const app = createApp({ authRateLimitMax: 1000 });
const users = createTestUsers(app);

/** A user with an API key and two endpoints subscribed to order.created. */
async function setup() {
  const user = await users.signUp();
  const res = await request(app)
    .post("/api/v1/api-keys")
    .set("Cookie", user.cookie)
    .send({ name: "queue" });
  await prisma.endpoint.createMany({
    data: [1, 2].map((n) => ({
      userId: user.id,
      name: `receiver ${n}`,
      url: "https://hooks.example.com/",
      eventTypes: ["order.created"],
      signingSecretEncrypted: "x",
    })),
  });
  return { ...user, key: res.body.data.rawKey as string };
}

function ingest(target: Express, key: string, idempotencyKey?: string) {
  const req = request(target).post("/api/v1/events").set("Authorization", `Bearer ${key}`);
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  return req.send({ type: "order.created", data: { note: "payload-marker" } });
}

const deliveriesOf = (eventId: string) => prisma.delivery.findMany({ where: { eventId } });

describe("queueing deliveries", () => {
  beforeAll(async () => {
    await getDeliveryProducer().ready();
  });

  afterAll(async () => {
    await users.cleanup();
    await closeDeliveryProducer();
    await prisma.$disconnect();
  });

  it("adds one single-attempt job per delivery, carrying only the delivery ID", async () => {
    const user = await setup();
    const res = await ingest(app, user.key);
    expect(res.status).toBe(202);

    const deliveries = await deliveriesOf(res.body.data.id);
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      const job = await getDeliveryProducer().queue.getJob(`${delivery.id}-1`);
      expect(job?.data).toEqual({ deliveryId: delivery.id });
      expect(job?.opts).toMatchObject({ attempts: 1, removeOnComplete: true, removeOnFail: true });
      expect(await job?.getState()).toBe("waiting");
    }
  });

  it("keeps one job when the same attempt is added twice", async () => {
    const producer = getDeliveryProducer();
    const ref = { deliveryId: `dup-${Date.now()}`, attemptNumber: 1 };
    await producer.enqueue([ref]);
    await producer.enqueue([ref]);

    const jobs = await producer.queue.getJobs(["waiting"]);
    expect(jobs.filter((j) => j.data.deliveryId === ref.deliveryId)).toHaveLength(1);
  });

  it("queues nothing for a replayed idempotency key", async () => {
    const enqueueDeliveries = vi.fn().mockResolvedValue(undefined);
    const spied = createApp({ authRateLimitMax: 1000, enqueueDeliveries });
    const user = await setup();

    await ingest(spied, user.key, "once");
    await ingest(spied, user.key, "once");

    expect(enqueueDeliveries).toHaveBeenCalledTimes(1);
    expect(enqueueDeliveries.mock.calls[0]![0]).toHaveLength(2);
  });

  it.each([
    ["fails", () => Promise.reject(new Error("queue down"))],
    ["never finishes", () => new Promise<void>(() => {})],
  ])("still accepts the event when queueing %s", async (_name, enqueueDeliveries) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = createApp({ authRateLimitMax: 1000, enqueueDeliveries });
    const user = await setup();

    const res = await ingest(broken, user.key);

    expect(res.status).toBe(202);
    expect(res.body.data.deliveriesCreated).toBe(2);
    const deliveries = await deliveriesOf(res.body.data.id);
    expect(deliveries.map((d) => d.status)).toEqual(["PENDING", "PENDING"]);
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain(res.body.data.id);
    expect(logged).not.toContain("payload-marker");
    errors.mockRestore();
  }, 30_000);

  it("rejects at once when Redis is unreachable", async () => {
    // Nothing listens on port 1
    const producer = createDeliveryProducer({
      redisUrl: "redis://localhost:1",
      prefix: config.QUEUE_PREFIX,
    });
    await expect(producer.enqueue([{ deliveryId: "x", attemptNumber: 1 }])).rejects.toThrow(
      "Redis is not connected"
    );
    await producer.close();
  });
});
