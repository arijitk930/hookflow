import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiError } from "@hookflow/shared";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".") || "_root";
      if (!details[path]) details[path] = [];
      details[path].push(issue.message);
    }

    const payload: ApiError = {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details,
      },
    };
    res.status(400).json(payload);
    return;
  }

  if (err instanceof AppError) {
    const payload: ApiError = {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(payload);
    return;
  }

  // Handle standard JSON syntax errors from body-parser
  if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
    const payload: ApiError = {
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON in request body",
      },
    };
    res.status(400).json(payload);
    return;
  }

  console.error("Unhandled error:", err);
  const payload: ApiError = {
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : (err?.message ?? "An unexpected error occurred"),
    },
  };
  res.status(500).json(payload);
};
