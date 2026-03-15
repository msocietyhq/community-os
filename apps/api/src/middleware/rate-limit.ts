import Elysia from "elysia";

interface RateLimitOptions {
	max: number;
	windowMs: number;
}

const store = new Map<string, { count: number; resetAt: number }>();

// Cleanup expired entries every 60s
const cleanup = setInterval(() => {
	const now = Date.now();
	for (const [key, value] of store) {
		if (now > value.resetAt) store.delete(key);
	}
}, 60_000);
cleanup.unref();

const authStore = new Map<string, { count: number; resetAt: number }>();

// Cleanup for auth store too
const authCleanup = setInterval(() => {
	const now = Date.now();
	for (const [key, value] of authStore) {
		if (now > value.resetAt) authStore.delete(key);
	}
}, 60_000);
authCleanup.unref();

function getClientIp(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0].trim();
	const realIp = request.headers.get("x-real-ip");
	if (realIp) return realIp;
	return "unknown";
}

export function rateLimit({ max, windowMs }: RateLimitOptions) {
	return new Elysia({ name: "rate-limit" }).onBeforeHandle(
		({ request, set }) => {
			const ip = getClientIp(request);
			const key = `${ip}`;
			const now = Date.now();

			let record = store.get(key);
			if (!record || now > record.resetAt) {
				record = { count: 0, resetAt: now + windowMs };
				store.set(key, record);
			}

			record.count++;

			set.headers["X-RateLimit-Limit"] = String(max);
			set.headers["X-RateLimit-Remaining"] = String(
				Math.max(0, max - record.count),
			);

			if (record.count > max) {
				const retryAfter = Math.ceil((record.resetAt - now) / 1000);
				set.status = 429;
				set.headers["Retry-After"] = String(retryAfter);
				return {
					error: {
						code: "RATE_LIMITED",
						message: `Too many requests. Try again in ${retryAfter} seconds.`,
					},
				};
			}
		},
	);
}

export function authRateLimit({ max, windowMs }: RateLimitOptions) {
	return new Elysia({ name: "auth-rate-limit" }).onRequest(
		({ request, set }) => {
			const url = new URL(request.url);
			if (!url.pathname.startsWith("/api/auth")) return;

			const ip = getClientIp(request);
			const key = `auth:${ip}`;
			const now = Date.now();

			let record = authStore.get(key);
			if (!record || now > record.resetAt) {
				record = { count: 0, resetAt: now + windowMs };
				authStore.set(key, record);
			}

			record.count++;

			if (record.count > max) {
				const retryAfter = Math.ceil((record.resetAt - now) / 1000);
				return new Response(
					JSON.stringify({
						error: {
							code: "RATE_LIMITED",
							message: `Too many requests. Try again in ${retryAfter} seconds.`,
						},
					}),
					{
						status: 429,
						headers: {
							"Retry-After": String(retryAfter),
							"Content-Type": "application/json",
						},
					},
				);
			}
		},
	);
}
