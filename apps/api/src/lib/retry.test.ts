import { describe, expect, test } from "bun:test";
import { withRetry, isRetryableError, retryAfterMs } from "./retry";

/** No real waiting; records what the backoff asked for. */
function fakeSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

/** Full jitter at its ceiling, so delays are deterministic. */
const maxJitter = () => 0.999999;

const httpError = (status: number, headers?: Record<string, string>) =>
  Object.assign(new Error(`HTTP ${status}`), {
    status,
    responseHeaders: headers,
  });

describe("isRetryableError", () => {
  test("429 is retryable", () => {
    expect(isRetryableError(httpError(429))).toBe(true);
  });

  test("5xx is retryable", () => {
    expect(isRetryableError(httpError(503))).toBe(true);
  });

  test("400 is not retryable", () => {
    expect(isRetryableError(httpError(400))).toBe(false);
  });

  test("401 is not retryable — a bad key won't fix itself", () => {
    expect(isRetryableError(httpError(401))).toBe(false);
  });

  test("transient network messages are retryable", () => {
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("Overloaded"))).toBe(true);
  });

  test("an ordinary error is not retryable", () => {
    expect(isRetryableError(new Error("column does not exist"))).toBe(false);
  });
});

describe("retryAfterMs", () => {
  test("reads seconds from the header", () => {
    expect(retryAfterMs(httpError(429, { "retry-after": "30" }))).toBe(30_000);
  });

  test("is case-insensitive about the header name", () => {
    expect(retryAfterMs(httpError(429, { "Retry-After": "5" }))).toBe(5_000);
  });

  test("returns null when absent", () => {
    expect(retryAfterMs(httpError(429))).toBeNull();
  });

  test("returns null for an unparseable value", () => {
    expect(retryAfterMs(httpError(429, { "retry-after": "soon" }))).toBeNull();
  });
});

describe("withRetry", () => {
  test("returns the value when the first attempt succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries a transient failure and then succeeds", async () => {
    const { sleep, delays } = fakeSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw httpError(429);
        return "ok";
      },
      { sleep, random: maxJitter, baseDelayMs: 1000 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
  });

  test("backs off exponentially", async () => {
    const { sleep, delays } = fakeSleep();
    await withRetry(
      async () => {
        throw httpError(503);
      },
      { sleep, random: maxJitter, baseDelayMs: 1000, attempts: 4 },
    ).catch(() => {});
    // Ceilings 1000, 2000, 4000 with jitter pinned near the top.
    expect(delays.map((d) => Math.round(d / 1000))).toEqual([1, 2, 4]);
  });

  test("caps the delay at maxDelayMs", async () => {
    const { sleep, delays } = fakeSleep();
    await withRetry(
      async () => {
        throw httpError(503);
      },
      {
        sleep,
        random: maxJitter,
        baseDelayMs: 10_000,
        maxDelayMs: 15_000,
        attempts: 4,
      },
    ).catch(() => {});
    for (const d of delays) expect(d).toBeLessThanOrEqual(15_000);
  });

  test("honours Retry-After over the computed backoff", async () => {
    const { sleep, delays } = fakeSleep();
    await withRetry(
      async () => {
        throw httpError(429, { "retry-after": "30" });
      },
      { sleep, random: maxJitter, baseDelayMs: 1000, attempts: 2 },
    ).catch(() => {});
    expect(delays[0]).toBe(30_000);
  });

  test("rethrows a non-retryable error immediately", async () => {
    const { sleep, delays } = fakeSleep();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw httpError(400);
        },
        { sleep },
      ),
    ).rejects.toThrow("HTTP 400");
    expect(calls).toBe(1);
    expect(delays).toHaveLength(0);
  });

  test("gives up after the attempt budget and rethrows the last error", async () => {
    const { sleep } = fakeSleep();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw httpError(429);
        },
        { sleep, random: maxJitter, attempts: 3 },
      ),
    ).rejects.toThrow("HTTP 429");
    expect(calls).toBe(3);
  });

  test("reports each retry", async () => {
    const { sleep } = fakeSleep();
    const seen: number[] = [];
    await withRetry(
      async () => {
        throw httpError(429);
      },
      {
        sleep,
        random: maxJitter,
        attempts: 3,
        onRetry: ({ attempt }) => seen.push(attempt),
      },
    ).catch(() => {});
    expect(seen).toEqual([1, 2]);
  });
});
