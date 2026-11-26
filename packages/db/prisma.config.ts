import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Prisma 7 configuration file.
 * - datasource.url: used by the Prisma CLI for migrations and `prisma generate`
 * - The runtime PrismaClient uses @prisma/adapter-pg (see src/index.ts)
 *
 * Neon exposes two connection strings:
 * - DATABASE_URL: pooled (PgBouncer) endpoint, used by the app at runtime
 * - DATABASE_URL_UNPOOLED: direct endpoint, required for migrations because
 *   PgBouncer's transaction pooling breaks Prisma's migration advisory locks
 *
 * Falls back to a placeholder so `prisma generate` works without a real DB URL.
 */
export default defineConfig({
  schema: "./prisma/schema.prisma",
  migrations: {
    path: "./prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "postgresql://localhost/placeholder",
  },
});
