import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { auth } from "./auth";
import { healthRoutes } from "./routes/health";
import { memberRoutes } from "./routes/members";
import { eventRoutes } from "./routes/events";
import { projectRoutes } from "./routes/projects";
import { infraRoutes } from "./routes/infra";
import { fundRoutes } from "./routes/funds";
import { reputationRoutes } from "./routes/reputation";
import { env } from "./env";

const app = new Elysia()
  .use(cors())
  .use(
    openapi({
      documentation: {
        info: {
          title: "community-os API",
          version: "0.1.0",
          description: "API for MSOCIETY community management",
        },
      },
    })
  )
  .mount("/api/auth", auth.handler)
  .use(healthRoutes)
  .use(memberRoutes)
  .use(eventRoutes)
  .use(projectRoutes)
  .use(infraRoutes)
  .use(fundRoutes)
  .use(reputationRoutes)
  .listen(env.PORT);

console.log(
  `community-os API running at ${app.server?.hostname}:${app.server?.port}`
);

export type App = typeof app;
