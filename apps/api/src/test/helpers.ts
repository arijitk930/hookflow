import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { SESSION_COOKIE } from "../auth/session.js";

/**
 * Registers throwaway users against the real database and removes them afterwards.
 * Deleting a user cascades to its sessions, API keys, endpoints and events.
 */
export function createTestUsers(app: Express) {
  const emails: string[] = [];

  return {
    /** Registers a fresh user and returns its id and a `Cookie` header value. */
    async signUp(): Promise<{ id: string; email: string; cookie: string }> {
      const email = `test-${randomUUID()}@hookflow.test`;
      emails.push(email);

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ email, password: "s3cure-passw0rd" });
      if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);

      const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
      const cookie = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
      return { id: res.body.data.id, email, cookie };
    },

    async cleanup(): Promise<void> {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    },
  };
}
