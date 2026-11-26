/**
 * packages/db — Prisma 7 singleton client
 *
 * Prisma 7 requires a driver adapter for all databases.
 * We use @prisma/adapter-pg (node-postgres) for PostgreSQL.
 *
 * The DATABASE_URL env var is read here at runtime.
 * The Prisma CLI reads it from prisma.config.ts at migration time.
 *
 * Generated client lives at: prisma/generated/prisma/
 * Run `pnpm --filter @hookflow/db db:generate` to regenerate.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/prisma/client.js";

if (!process.env.DATABASE_URL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
  dotenv.config();
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Copy .env.example to .env and fill in the values."
    );
  }

  const adapter = new PrismaPg({
    // Neon issues `sslmode=require`, which pg 8 already treats as verify-full
    // (and warns about). Say so explicitly so the behaviour survives pg 9.
    connectionString: connectionString.replace(/sslmode=require\b/, "sslmode=verify-full"),
    // Match Prisma v6 default: 5 s connection timeout
    // (pg driver defaults to 0 = no timeout, which caused regressions in v7)
    connectionTimeoutMillis: 5000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}

/**
 * Singleton pattern: avoid creating a new pool on every hot-reload in dev.
 * globalThis persists across module re-evaluations in Node.js.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  __prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

// Re-export Prisma enums and namespace for convenience.
// Consumers import from "@hookflow/db" without depending on @prisma/client directly.
export {
  Prisma,
  DeliveryStatus,
  DeliveryOutcome,
} from "../prisma/generated/prisma/client.js";
export type { PrismaClient } from "../prisma/generated/prisma/client.js";
