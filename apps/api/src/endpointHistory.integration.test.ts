import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@hookflow/db";

const emails: string[] = [];

/** A user with one endpoint that has delivery history. */
async function createHistory() {
  const email = `history-${randomUUID()}@hookflow.test`;
  emails.push(email);
  const user = await prisma.user.create({ data: { email, passwordHash: "x" } });
  const endpoint = await prisma.endpoint.create({
    data: {
      userId: user.id,
      name: "receiver",
      url: "https://example.com/hook",
      eventTypes: ["order.created"],
      signingSecretEncrypted: "x",
    },
  });
  const event = await prisma.event.create({
    data: { userId: user.id, type: "order.created", payload: {} },
  });
  const delivery = await prisma.delivery.create({
    data: { eventId: event.id, endpointId: endpoint.id },
  });
  return { user, endpoint, delivery };
}

describe("Endpoint history rules (database)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("refuses to hard-delete an endpoint that has deliveries", async () => {
    const { endpoint, delivery } = await createHistory();

    await expect(prisma.endpoint.delete({ where: { id: endpoint.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    expect(await prisma.delivery.count({ where: { id: delivery.id } })).toBe(1);
  });

  it("keeps delivery history when an endpoint is soft-deleted", async () => {
    const { endpoint, delivery } = await createHistory();

    await prisma.endpoint.update({ where: { id: endpoint.id }, data: { deletedAt: new Date() } });

    expect(await prisma.delivery.count({ where: { id: delivery.id } })).toBe(1);
  });

  it("still lets deleting a user remove all of their data", async () => {
    const { user, endpoint, delivery } = await createHistory();

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.endpoint.count({ where: { id: endpoint.id } })).toBe(0);
    expect(await prisma.delivery.count({ where: { id: delivery.id } })).toBe(0);
  });
});
