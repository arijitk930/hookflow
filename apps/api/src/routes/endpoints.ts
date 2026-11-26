import { Router, type Response, type Router as ExpressRouter } from "express";
import { z } from "zod";
import type { ApiSuccess } from "@hookflow/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { eventTypeSchema } from "../lib/eventType.js";
import type { UrlPolicy } from "../lib/ssrf.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createEndpointService } from "../services/endpoints.js";

const fields = {
  name: z.string().trim().min(1, "Name is required").max(100),
  url: z.string().trim().min(1, "URL is required").max(2048),
  eventTypes: z
    .array(eventTypeSchema)
    .min(1, "Subscribe to at least one event type")
    .max(50)
    .transform((types) => [...new Set(types)]),
  isActive: z.boolean(),
};

// strict(): unknown fields such as userId or deletedAt are rejected, not ignored
const createSchema = z.object({ ...fields, isActive: fields.isActive.optional() }).strict();
const updateSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

function send<T>(res: Response, status: number, data: T): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(status).json(body);
}

export function createEndpointsRouter(urlPolicy: UrlPolicy): ExpressRouter {
  const endpoints = createEndpointService(urlPolicy);
  const router = Router();

  // Every route is dashboard-only and scoped to the signed-in user
  router.use(requireAuth);

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const created = await endpoints.create(req.user!.id, createSchema.parse(req.body));
      // Contains the signing secret
      res.set("Cache-Control", "no-store");
      send(res, 201, created);
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => send(res, 200, await endpoints.list(req.user!.id)))
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      send(res, 200, await endpoints.get(req.user!.id, id));
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      send(res, 200, await endpoints.update(req.user!.id, id, updateSchema.parse(req.body)));
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      await endpoints.remove(req.user!.id, id);
      res.status(204).end();
    })
  );

  router.post(
    "/:id/rotate-secret",
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const rotated = await endpoints.rotateSecret(req.user!.id, id);
      res.set("Cache-Control", "no-store");
      send(res, 200, rotated);
    })
  );

  return router;
}
