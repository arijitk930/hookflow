import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "@hookflow/db";
import { getRedisClient } from "../redis.js";
import { checkBucket } from "../storage.js";
import type { ApiSuccess, ApiError } from "@hookflow/shared";

export const healthRouter: ExpressRouter = Router();

export interface HealthData {
  status: "healthy" | "degraded";
  timestamp: string;
  uptime: number;
  services: {
    database: "connected" | "disconnected";
    redis: "connected" | "disconnected";
    storage: "connected" | "disconnected";
  };
}

healthRouter.get("/", async (_req, res) => {
  let dbStatus: "connected" | "disconnected" = "disconnected";
  let redisStatus: "connected" | "disconnected" = "disconnected";

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    dbStatus = "connected";
  } catch (err) {
    console.error("Health check - Database error:", err);
  }

  try {
    const redis = getRedisClient();
    const pingResult = await redis.ping();
    if (pingResult === "PONG") {
      redisStatus = "connected";
    }
  } catch (err) {
    console.error("Health check - Redis error:", err);
  }

  let storageStatus: "connected" | "disconnected" = "disconnected";
  try {
    await checkBucket();
    storageStatus = "connected";
  } catch (err) {
    console.error("Health check - Storage error:", err);
  }

  const isHealthy =
    dbStatus === "connected" &&
    redisStatus === "connected" &&
    storageStatus === "connected";
  const statusCode = isHealthy ? 200 : 503;

  const response: ApiSuccess<HealthData> = {
    ok: true,
    data: {
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime() * 100) / 100,
      services: {
        database: dbStatus,
        redis: redisStatus,
        storage: storageStatus,
      },
    },
  };

  res.status(statusCode).json(response);
});
