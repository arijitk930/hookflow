import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { prisma } from "@hookflow/db";
import type { ApiKeyCreatedDto, ApiKeyDto, ApiSuccess } from "@hookflow/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { generateApiKey, hashToken } from "../lib/tokens.js";
import { AppError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const MAX_ACTIVE_API_KEYS = 10;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64),
});

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

const apiKeySelect = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

function toApiKeyDto(key: ApiKeyRow): ApiKeyDto {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

export const apiKeysRouter: ExpressRouter = Router();

// Every route is dashboard-only and scoped to the signed-in user
apiKeysRouter.use(requireAuth);

apiKeysRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name } = createSchema.parse(req.body);
    const userId = req.user!.id;

    const activeCount = await prisma.apiKey.count({ where: { userId, revokedAt: null } });
    if (activeCount >= MAX_ACTIVE_API_KEYS) {
      throw new AppError(
        409,
        "API_KEY_LIMIT_REACHED",
        `You can have at most ${MAX_ACTIVE_API_KEYS} active API keys; revoke one first`
      );
    }

    const { rawKey, displayPrefix } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: { userId, name, prefix: displayPrefix, keyHash: hashToken(rawKey) },
      select: apiKeySelect,
    });

    // The only response that ever contains the raw key
    res.set("Cache-Control", "no-store");
    const body: ApiSuccess<ApiKeyCreatedDto> = { ok: true, data: { ...toApiKeyDto(key), rawKey } };
    res.status(201).json(body);
  })
);

apiKeysRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user!.id },
      select: apiKeySelect,
      orderBy: { createdAt: "desc" },
    });

    const body: ApiSuccess<ApiKeyDto[]> = { ok: true, data: keys.map(toApiKeyDto) };
    res.json(body);
  })
);

apiKeysRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const userId = req.user!.id;

    // Scoped by userId: another user's key is indistinguishable from a missing one
    const key = await prisma.apiKey.findFirst({
      where: { id, userId },
      select: { revokedAt: true },
    });
    if (!key) throw new AppError(404, "NOT_FOUND", "API key not found");

    // Idempotent: revoking an already revoked key keeps the original revokedAt
    if (!key.revokedAt) {
      await prisma.apiKey.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    res.status(204).end();
  })
);
