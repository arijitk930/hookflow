import { Router, type RequestHandler, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@hookflow/db";
import type { ApiSuccess, UserDto } from "@hookflow/shared";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  sessionCookieOptions,
  type SessionUser,
} from "../auth/session.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../lib/password.js";
import { AppError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email").max(254),
  // Upper bound keeps hashing cost bounded for oversized inputs
  password: z.string().min(8, "Must be at least 8 characters").max(128),
});

const loginSchema = credentialsSchema.extend({
  // Don't leak the password policy on login; any non-empty password is checked
  password: z.string().min(1, "Password is required").max(128),
});

function toUserDto(user: SessionUser): UserDto {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

const userSelect = { id: true, email: true, createdAt: true } as const;

/** `rateLimiter` guards the credential endpoints (register/login) against brute force. */
export function createAuthRouter(rateLimiter: RequestHandler): ExpressRouter {
  const router = Router();

  router.post(
    "/register",
    rateLimiter,
    asyncHandler(async (req, res) => {
      const { email, password } = credentialsSchema.parse(req.body);

      let user: SessionUser;
      try {
        user = await prisma.user.create({
          data: { email, passwordHash: await hashPassword(password) },
          select: userSelect,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
        }
        throw err;
      }

      res.cookie(SESSION_COOKIE, await createSession(user.id), sessionCookieOptions);
      const body: ApiSuccess<UserDto> = { ok: true, data: toUserDto(user) };
      res.status(201).json(body);
    })
  );

  router.post(
    "/login",
    rateLimiter,
    asyncHandler(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { email },
        select: { ...userSelect, passwordHash: true },
      });

      // Always run a verification so unknown emails and wrong passwords take equal time
      const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !valid) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
      }

      res.cookie(SESSION_COOKIE, await createSession(user.id), sessionCookieOptions);
      const body: ApiSuccess<UserDto> = { ok: true, data: toUserDto(user) };
      res.status(200).json(body);
    })
  );

  router.post(
    "/logout",
    requireAuth,
    asyncHandler(async (req, res) => {
      await deleteSession(req.sessionId!);
      const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions;
      res.clearCookie(SESSION_COOKIE, clearOptions);
      res.status(204).end();
    })
  );

  router.get("/me", requireAuth, (req, res) => {
    const body: ApiSuccess<UserDto> = { ok: true, data: toUserDto(req.user!) };
    res.json(body);
  });

  return router;
}
