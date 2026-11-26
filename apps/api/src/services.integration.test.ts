import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@hookflow/db";
import { deleteObject, getObjectText, putObject, closeStorageClient } from "./storage.js";

/**
 * End-to-end checks against the real backing services configured in .env
 * (Neon Postgres + Neon object storage). They leave no data behind.
 */
describe("Backing services (integration)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    closeStorageClient();
  });

  it("Postgres: writes and reads a row inside a rolled-back transaction", async () => {
    const email = `integration-${randomUUID()}@hookflow.test`;
    const rollback = new Error("rollback");

    await expect(
      prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, passwordHash: "x" } });
        const found = await tx.user.findUnique({ where: { id: created.id } });
        expect(found?.email).toBe(email);
        throw rollback;
      })
    ).rejects.toBe(rollback);

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("Object storage: puts, reads back and deletes an object", async () => {
    const key = `healthchecks/${randomUUID()}.txt`;
    const body = `hookflow storage check ${new Date().toISOString()}`;

    await putObject(key, body, "text/plain");
    try {
      expect(await getObjectText(key)).toBe(body);
    } finally {
      await deleteObject(key);
    }

    await expect(getObjectText(key)).rejects.toThrow();
  });
});
