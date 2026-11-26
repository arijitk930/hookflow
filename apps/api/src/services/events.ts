import { Prisma, prisma } from "@hookflow/db";
import type { DeliveryRef } from "@hookflow/queue";
import type {
  EventDetailDto,
  EventSummaryDto,
  IngestEventResponse,
  Page,
} from "@hookflow/shared";
import { withTimeout } from "../lib/withTimeout.js";
import { AppError } from "../middleware/errorHandler.js";

/** Longest an ingestion request waits for the queue. */
export const ENQUEUE_TIMEOUT_MS = 1000;

export type EnqueueDeliveries = (deliveries: DeliveryRef[]) => Promise<void>;

export interface IngestInput {
  type: string;
  data: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface IngestResult {
  event: IngestEventResponse;
  /** True when the idempotency key matched an earlier event and nothing was created. */
  replayed: boolean;
}

export interface ListFilters {
  type?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

const acceptedSelect = {
  id: true,
  type: true,
  createdAt: true,
  _count: { select: { deliveries: true } },
} as const;

type AcceptedRow = { id: string; type: string; createdAt: Date; _count: { deliveries: number } };

function toAccepted(row: AcceptedRow): IngestEventResponse {
  return {
    id: row.id,
    type: row.type,
    status: "accepted",
    deliveriesCreated: row._count.deliveries,
    createdAt: row.createdAt.toISOString(),
  };
}

function findByIdempotencyKey(userId: string, idempotencyKey: string) {
  return prisma.event.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: acceptedSelect,
  });
}

/**
 * Best effort. The delivery rows are already committed, so a failure here must
 * not fail the request: they stay PENDING for recovery to pick up.
 */
async function queueFirstAttempts(
  eventId: string,
  deliveries: { id: string }[],
  enqueue: EnqueueDeliveries
): Promise<void> {
  if (deliveries.length === 0) return;
  try {
    const refs = deliveries.map((d) => ({ deliveryId: d.id, attemptNumber: 1 }));
    await withTimeout(enqueue(refs), ENQUEUE_TIMEOUT_MS);
  } catch (err) {
    console.error(
      `Could not queue ${deliveries.length} deliveries for event ${eventId}: ` +
        (err instanceof Error ? err.message : "unknown error")
    );
  }
}

/**
 * Persists an event with one PENDING delivery per matching active endpoint,
 * then queues them. Event and deliveries are written atomically *before*
 * queueing, so a job never refers to a row that doesn't exist.
 */
export async function ingestEvent(
  userId: string,
  input: IngestInput,
  enqueue: EnqueueDeliveries
): Promise<IngestResult> {
  const { type, data, idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return { event: toAccepted(existing), replayed: true };
  }

  const endpoints = await prisma.endpoint.findMany({
    where: { userId, isActive: true, deletedAt: null, eventTypes: { has: type } },
    select: { id: true },
  });

  const now = new Date();
  let created;
  try {
    // A nested create runs in a single transaction
    created = await prisma.event.create({
      data: {
        userId,
        type,
        payload: data as Prisma.InputJsonObject,
        idempotencyKey,
        deliveries: {
          create: endpoints.map((e) => ({ endpointId: e.id, nextAttemptAt: now })),
        },
      },
      select: { ...acceptedSelect, deliveries: { select: { id: true } } },
    });
  } catch (err) {
    // A concurrent request with the same key won the unique constraint: return its event
    if (
      idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await findByIdempotencyKey(userId, idempotencyKey);
      if (winner) return { event: toAccepted(winner), replayed: true };
    }
    throw err;
  }

  await queueFirstAttempts(created.id, created.deliveries, enqueue);
  return { event: toAccepted(created), replayed: false };
}

export async function listEvents(
  userId: string,
  { type, from, to, limit, cursor }: ListFilters
): Promise<Page<EventSummaryDto>> {
  if (cursor && !(await prisma.event.findFirst({ where: { id: cursor, userId }, select: { id: true } }))) {
    throw new AppError(400, "INVALID_CURSOR", "Unknown pagination cursor");
  }

  const rows = await prisma.event.findMany({
    where: { userId, type, createdAt: { gte: from, lte: to } },
    // id breaks ties between events created in the same millisecond
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra row tells us whether another page exists
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { ...acceptedSelect, idempotencyKey: true },
  });

  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt.toISOString(),
      deliveryCount: row._count.deliveries,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

export async function getEvent(userId: string, id: string): Promise<EventDetailDto> {
  const row = await prisma.event.findFirst({
    where: { id, userId },
    include: {
      deliveries: {
        orderBy: { createdAt: "asc" },
        // History includes soft-deleted endpoints, flagged as such
        include: { endpoint: { select: { name: true, deletedAt: true } } },
      },
    },
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "Event not found");

  return {
    id: row.id,
    type: row.type,
    payload: row.payload as Record<string, unknown>,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
    deliveries: row.deliveries.map((d) => ({
      id: d.id,
      endpointId: d.endpointId,
      endpointName: d.endpoint.name,
      endpointDeleted: d.endpoint.deletedAt !== null,
      status: d.status,
      attemptCount: d.attemptCount,
      lastStatusCode: d.lastStatusCode,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}
