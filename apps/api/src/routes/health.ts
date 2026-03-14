import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ prefix: "/api/v1" }).get(
  "/health",
  () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  }),
  {
    detail: {
      tags: ["Health"],
      summary: "Health check",
    },
  }
);
