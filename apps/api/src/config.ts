import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config(); // also allow local .env if present

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Neon object storage (S3-compatible); values come from `neon deploy` / `neon env pull`
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  AWS_ENDPOINT_URL_S3: z.string().url("AWS_ENDPOINT_URL_S3 must be a URL"),
  AWS_REGION: z.string().min(1, "AWS_REGION is required"),
  STORAGE_BUCKET: z.string().default("uploads"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  // Dashboard origin allowed to call the API with credentials (cookies)
  // Normalised to scheme://host[:port], the form browsers send in the Origin header
  WEB_ORIGIN: z
    .string()
    .url()
    .default("http://localhost:3001")
    .transform((value) => new URL(value).origin),
  // Max register/login attempts per IP per 15 minutes
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  JWT_SECRET: z.string().min(16, "JWT_SECRET should be at least 16 chars"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET should be at least 16 chars"),
  // AES-256 key for endpoint signing secrets
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  // Event ingestion limits
  EVENT_MAX_BYTES: z.coerce.number().int().positive().max(1_048_576).default(262_144),
  EVENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  // Rejected API keys per IP per 15 minutes
  INGEST_AUTH_FAILURE_LIMIT: z.coerce.number().int().positive().default(50),
  // Comma-separated host:port values exempt from SSRF checks, for local test receivers
  SSRF_ALLOWED_PRIVATE_HOSTS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().default(10000),
  WEBHOOK_MAX_RESPONSE_BYTES: z.coerce.number().default(65536),
});

const parsed = envSchema.safeParse({
  ...process.env,
  PORT: process.env.API_PORT ?? process.env.PORT ?? 4000,
});

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.format());
  throw new Error("Invalid environment configuration");
}

if (parsed.data.NODE_ENV === "production" && parsed.data.SSRF_ALLOWED_PRIVATE_HOSTS.length > 0) {
  throw new Error("SSRF_ALLOWED_PRIVATE_HOSTS must be empty in production");
}

export const config = parsed.data;
export type Config = typeof config;
