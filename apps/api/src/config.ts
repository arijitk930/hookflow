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
  WEB_ORIGIN: z.string().url().default("http://localhost:3001"),
  // Max register/login attempts per IP per 15 minutes
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  JWT_SECRET: z.string().min(16, "JWT_SECRET should be at least 16 chars"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET should be at least 16 chars"),
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY should be at least 16 chars"),
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

export const config = parsed.data;
export type Config = typeof config;
