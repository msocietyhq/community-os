import { Elysia } from "elysia";
import { rateLimit } from "elysia-rate-limit";

/**
 * General rate limiter — 100 req/min per IP.
 * Uses elysia-rate-limit (onBeforeHandle), so it applies to
 * all regular routes but NOT .mount()-ed handlers.
 */
export const generalRateLimit = rateLimit({
  max: 100,
  duration: 60_000,
  generator: (request, server) => {
    // Prefer x-forwarded-for behind Railway proxy
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() ?? forwarded;
    return server?.requestIP(request)?.address ?? "unknown";
  },
  errorResponse: new Response(
    JSON.stringify({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
      },
    }),
    {
      status: 429,
      headers: { "Content-Type": "application/json" },
    },
  ),
});

/**
 * Auth rate limiter — 10 req/min per IP for /api/auth paths.
 * Uses onRequest so it fires for .mount()-ed auth handler.
 */
const authStore = new Map<string, { count: number; resetAt: number }>();

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of authStore) {
    if (now > value.resetAt) authStore.delete(key);
  }
}, 60_000);
cleanup.unref();

export const authRateLimit = new Elysia({ name: "auth-rate-limit" }).onRequest(
  ({ request, set }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/auth")) return;

    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    const now = Date.now();

    let record = authStore.get(ip);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + 60_000 };
      authStore.set(ip, record);
    }

    record.count++;

    if (record.count > 10) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      return new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }
  },
);
