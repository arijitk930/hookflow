import { Redis } from "ioredis";
import { config } from "./config.js";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      // Fail commands quickly when Redis is unreachable
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy(times) {
        if (config.NODE_ENV === "test") return null;
        return Math.min(times * 200, 2000);
      },
    });

    redisClient.on("error", (err) => {
      // In tests, avoid cluttering console on expected failures
      if (config.NODE_ENV !== "test") {
        console.error("Redis connection error:", err.message);
      }
    });
  }

  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    // quit() would wait for an unreachable server
    if (redisClient.status === "ready") await redisClient.quit();
    else redisClient.disconnect();
    redisClient = null;
  }
}
