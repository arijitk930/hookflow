/**
 * @hookflow/shared
 *
 * Shared TypeScript types and enums used across the API, worker, and web packages.
 * These are plain TypeScript — no runtime dependencies. Zod schemas for validation
 * live in the API package itself to avoid pulling Zod into the worker unnecessarily.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum DeliveryStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  RETRYING = "RETRYING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
}

export enum DeliveryOutcome {
  SUCCESS = "SUCCESS",
  HTTP_ERROR = "HTTP_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface UserDto {
  id: string;
  email: string;
  createdAt: string; // ISO-8601
}

export interface ApiKeyDto {
  id: string;
  name: string;
  /** Short prefix shown in the UI — never the full key */
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once at creation time only; never returned again */
export interface ApiKeyCreatedDto extends ApiKeyDto {
  rawKey: string;
}

export interface EndpointDto {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface DeliveryDto {
  id: string;
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  succeededAt: string | null;
  createdAt: string;
  updatedAt: string;
  eventId: string;
  endpointId: string;
}

export interface DeliveryAttemptDto {
  id: string;
  attemptNumber: number;
  outcome: DeliveryOutcome;
  statusCode: number | null;
  durationMs: number;
  responseBody: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string;
  deliveryId: string;
}

// ─── API response wrappers ───────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    /** Field-level validation errors */
    details?: Record<string, string[]>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Event ingestion ─────────────────────────────────────────────────────────

/** Shape returned by POST /api/v1/events */
export interface IngestEventResponse {
  eventId: string;
  type: string;
  status: "accepted" | "duplicate";
  deliveriesCreated: number;
  timestamp: string;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface OverviewStats {
  totalDeliveries: number;
  successCount: number;
  failedCount: number;
  retryingCount: number;
  successRate: number; // 0–100
  avgDurationMs: number | null;
}

// ─── BullMQ job payloads (shared between API and worker) ─────────────────────

export interface WebhookJobPayload {
  deliveryId: string;
  attemptNumber: number;
}
