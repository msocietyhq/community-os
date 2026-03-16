import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { auth, authOpenAPI } from "./auth";
import { healthRoutes } from "./routes/health";
import { memberRoutes } from "./routes/members";
import { eventRoutes } from "./routes/events";
import { projectRoutes } from "./routes/projects";
import { infraRoutes } from "./routes/infra";
import { fundRoutes } from "./routes/funds";
import { reputationRoutes } from "./routes/reputation";
import { venueRoutes } from "./routes/venues";
import { botRoutes } from "./routes/bot";
import { AppError } from "./lib/errors";
import { authRateLimit, generalRateLimit } from "./middleware/rate-limit";
import { env } from "./env";

function extractValidationDetails(error: Error): string {
  return error.message;
}

export const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      };
    }

    if (code === "VALIDATION") {
      set.status = 400;
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: extractValidationDetails(error),
        },
      };
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Route not found" } };
    }

    if (code === "PARSE") {
      set.status = 400;
      return {
        error: {
          code: "PARSE_ERROR",
          message: "Failed to parse request body",
        },
      };
    }

    // Fallback 500 — no stack traces in production
    set.status = 500;
    return {
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : ("message" in error ? error.message : "Unknown error"),
      },
    };
  })
  .use(cors({ origin: env.WEB_URL, credentials: true }))
  .use(generalRateLimit)
  .use(authRateLimit)
  .use(
    openapi({
      documentation: {
        info: {
          title: "community-os API",
          version: "0.1.0",
          description: "API for MSOCIETY community management",
        },
        paths: await authOpenAPI.getPaths(),
        components: {
          ...(await authOpenAPI.components),
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    }),
  )
  .mount(auth.handler)
  .use(healthRoutes)
  .use(memberRoutes)
  .use(eventRoutes)
  .use(projectRoutes)
  .use(infraRoutes)
  .use(fundRoutes)
  .use(venueRoutes)
  .use(reputationRoutes)
  .use(botRoutes);

export type App = typeof app;
