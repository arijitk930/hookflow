import type { CookieOptions } from "express";
import { prisma } from "@hookflow/db";
import { config } from "../config.js";
import { generateToken, hashToken } from "../lib/tokens.js";

export const SESSION_COOKIE = "hf_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_MS,
};

/** Creates a session row and returns the raw token for the cookie (never stored). */
export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  createdAt: Date;
}

/** Resolves a cookie token to its user, or null if unknown or expired. */
export async function getSessionUser(
  token: string
): Promise<{ sessionId: string; user: SessionUser } | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, email: true, createdAt: true } },
    },
  });
  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return { sessionId: session.id, user: session.user };
}

export async function deleteSession(sessionId: string): Promise<void> {
  // deleteMany: no error if a concurrent logout already removed it
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
