import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "@hookflow/db";
import { createApp } from "../app.js";
import { SESSION_COOKIE } from "../auth/session.js";
import { hashToken } from "../lib/tokens.js";
import { config } from "../config.js";

const app = createApp({ authRateLimitMax: 1000 });
const PASSWORD = "s3cure-passw0rd";
const createdEmails: string[] = [];

function uniqueEmail(): string {
  const email = `auth-test-${randomUUID()}@hookflow.test`;
  createdEmails.push(email);
  return email;
}

/** Returns the raw `hf_session=...` Set-Cookie header. */
function sessionCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error("No session cookie set");
  return cookie;
}

function tokenFrom(cookie: string): string {
  return decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
}

describe("Auth API", () => {
  afterAll(async () => {
    // Cascades to sessions
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  describe("POST /api/v1/auth/register", () => {
    it("creates the user, stores only hashes, and sets a secure session cookie", async () => {
      const email = uniqueEmail();
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: `  ${email.toUpperCase()} `, password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        ok: true,
        data: { id: expect.any(String), email, createdAt: expect.any(String) },
      });
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");

      const cookie = sessionCookie(res);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);

      // Only the token hash is persisted, never the raw cookie value
      const token = tokenFrom(cookie);
      const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.tokenHash).toBe(hashToken(token));
      expect(session.tokenHash).not.toBe(token);
    });

    it("rejects a duplicate email case-insensitively with 409", async () => {
      const email = uniqueEmail();
      await request(app).post("/api/v1/auth/register").send({ email, password: PASSWORD });

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: email.toUpperCase(), password: PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EMAIL_TAKEN");
    });

    it("validates email and password with field-level errors", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: "not-an-email", password: "short" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details).toHaveProperty("email");
      expect(res.body.error.details).toHaveProperty("password");
    });
  });

  describe("session lifecycle", () => {
    it("GET /me requires a session", async () => {
      const res = await request(app).get("/api/v1/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("GET /me rejects an unknown token", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Cookie", `${SESSION_COOKIE}=forged-token`);
      expect(res.status).toBe(401);
    });

    it("logs in, reads /me, logs out, and the old cookie stops working", async () => {
      const email = uniqueEmail();
      await request(app).post("/api/v1/auth/register").send({ email, password: PASSWORD });

      const login = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.data.email).toBe(email);
      const cookie = sessionCookie(login).split(";")[0]!;

      const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
      expect(me.status).toBe(200);
      expect(me.body.data.email).toBe(email);

      const logout = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
      expect(logout.status).toBe(204);
      expect(sessionCookie(logout)).toMatch(/Expires=Thu, 01 Jan 1970/);

      const after = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
      expect(after.status).toBe(401);
      expect(await prisma.session.count({ where: { tokenHash: hashToken(tokenFrom(cookie)) } })).toBe(0);
    });

    it("treats an expired session as unauthenticated and deletes it", async () => {
      const email = uniqueEmail();
      const reg = await request(app).post("/api/v1/auth/register").send({ email, password: PASSWORD });
      const cookie = sessionCookie(reg).split(";")[0]!;
      const tokenHash = hashToken(tokenFrom(cookie));

      await prisma.session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const res = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
      expect(res.status).toBe(401);
      expect(await prisma.session.count({ where: { tokenHash } })).toBe(0);
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("returns the same 401 for a wrong password and an unknown email", async () => {
      const email = uniqueEmail();
      await request(app).post("/api/v1/auth/register").send({ email, password: PASSWORD });

      const wrongPassword = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password: "wrong-password" });
      const unknownEmail = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: `nobody-${randomUUID()}@hookflow.test`, password: PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    });

    it("rate-limits repeated attempts from one client with 429", async () => {
      const limited = createApp({ authRateLimitMax: 2 });
      const attempt = () =>
        request(limited)
          .post("/api/v1/auth/login")
          .send({ email: `nobody-${randomUUID()}@hookflow.test`, password: "x" });

      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("CORS", () => {
    it("allows credentialed requests only from the dashboard origin", async () => {
      const allowed = await request(app).options("/api/v1/auth/me").set("Origin", config.WEB_ORIGIN);
      expect(allowed.headers["access-control-allow-origin"]).toBe(config.WEB_ORIGIN);
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

      // The header always names the dashboard, so browsers block any other origin
      const other = await request(app).options("/api/v1/auth/me").set("Origin", "https://evil.example");
      expect(other.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
      expect(other.headers["access-control-allow-origin"]).not.toBe("*");
    });
  });
});
