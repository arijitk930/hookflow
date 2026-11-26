import type { RequestHandler } from "express";
import type { ApiError } from "@hookflow/shared";

export const notFoundHandler: RequestHandler = (req, res) => {
  const payload: ApiError = {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  };
  res.status(404).json(payload);
};
