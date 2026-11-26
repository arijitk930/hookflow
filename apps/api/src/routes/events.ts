import express, { Router, type RequestHandler, type Router as ExpressRouter } from "express";
import { z } from "zod";
import type {
  ApiSuccess,
  EventDetailDto,
  EventSummaryDto,
  IngestEventResponse,
  Page,
} from "@hookflow/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { eventTypeSchema } from "../lib/eventType.js";
import { findJsonProblem } from "../lib/jsonSafety.js";
import { AppError } from "../middleware/errorHandler.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEvent, ingestEvent, listEvents } from "../services/events.js";

const ingestSchema = z
  .object({
    type: eventTypeSchema,
    data: z.record(z.unknown()).superRefine((data, ctx) => {
      const problem = findJsonProblem(data);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
  })
  .strict();

/** Printable ASCII, so keys are unambiguous in headers and logs. */
const idempotencyKeySchema = z
  .string()
  .regex(/^[\x21-\x7e]([\x20-\x7e]{0,253}[\x21-\x7e])?$/, "Must be 1-255 printable characters")
  .optional();

const listSchema = z
  .object({
    type: eventTypeSchema.optional(),
    from: z.string().datetime({ offset: true }).pipe(z.coerce.date()).optional(),
    to: z.string().datetime({ offset: true }).pipe(z.coerce.date()).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "`from` must not be after `to`",
    path: ["from"],
  });

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

const requireJson: RequestHandler = (req, _res, next) => {
  next(
    req.is("application/json")
      ? undefined
      : new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json")
  );
};

export interface EventsRouterOptions {
  maxBytes: number;
  authFailureLimiter: RequestHandler;
  ingestLimiter: RequestHandler;
}

export function createEventsRouter(options: EventsRouterOptions): ExpressRouter {
  const router = Router();

  // Ingestion: API key. Order matters — the body is only read for authenticated callers.
  router.post(
    "/",
    options.authFailureLimiter,
    requireApiKey,
    options.ingestLimiter,
    requireJson,
    express.json({ limit: options.maxBytes }),
    asyncHandler(async (req, res) => {
      const { type, data } = ingestSchema.parse(req.body);
      const idempotencyKey = idempotencyKeySchema.parse(req.get("idempotency-key"));

      const { event, replayed } = await ingestEvent(req.apiKey!.userId, {
        type,
        data,
        idempotencyKey,
      });

      if (replayed) res.set("Idempotent-Replayed", "true");
      const body: ApiSuccess<IngestEventResponse> = { ok: true, data: event };
      res.status(202).json(body);
    })
  );

  // Dashboard reads: session cookie, scoped to the signed-in user
  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const page = await listEvents(req.user!.id, listSchema.parse(req.query));
      const body: ApiSuccess<Page<EventSummaryDto>> = { ok: true, data: page };
      res.json(body);
    })
  );

  router.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const body: ApiSuccess<EventDetailDto> = { ok: true, data: await getEvent(req.user!.id, id) };
      res.json(body);
    })
  );

  return router;
}
