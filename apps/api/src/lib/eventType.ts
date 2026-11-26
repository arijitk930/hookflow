import { z } from "zod";

/** Dot-separated segments, e.g. `order.created`. Shared by subscriptions and ingestion. */
export const eventTypeSchema = z
  .string()
  .max(128)
  .regex(
    /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/,
    "Use lowercase letters, digits, _ or -, separated by dots (e.g. order.created)"
  );
