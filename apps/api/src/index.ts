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
import { botRoutes } from "./routes/bot";
import { initBot, shutdownBot } from "./bot/init";
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
        paths: await authOpenAPI.getPaths(),
        components: await authOpenAPI.components,
      },
    }),
  )
  .mount("/api/auth", auth.handler)
  .use(healthRoutes)
  .use(memberRoutes)
  .use(eventRoutes)
  .use(projectRoutes)
  .use(infraRoutes)
  .use(fundRoutes)
  .use(reputationRoutes)
  .use(botRoutes)
  .listen(env.PORT);

console.log(
  `MSOCIETY community-os API running at ${app.server?.hostname}:${app.server?.port}`,
);

// Initialize bot after server is listening so webhook endpoint is ready
initBot().catch((err) => {
  console.error("Failed to initialize bot:", err);
});

const shutdown = async () => {
  console.log("Shutting down...");
  await shutdownBot();
  app.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type App = typeof app;
