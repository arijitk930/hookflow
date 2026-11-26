import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "@hookflow/db";
import { closeDeliveryProducer, getDeliveryProducer } from "./queue.js";
import { closeRedisClient } from "./redis.js";
import { closeStorageClient } from "./storage.js";

// Connect to the queue now so the first event doesn't find it still connecting
getDeliveryProducer();

const server = app.listen(config.PORT, () => {
  console.log(`🚀 HookFlow API listening on http://localhost:${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
});

async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    console.log("HTTP server closed.");
    try {
      await prisma.$disconnect();
      console.log("Database connection closed.");
      await closeDeliveryProducer();
      await closeRedisClient();
      console.log("Redis connection closed.");
      closeStorageClient();
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  });

  // Force close after 10s if graceful shutdown hangs
  setTimeout(() => {
    console.error("Forceful shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
