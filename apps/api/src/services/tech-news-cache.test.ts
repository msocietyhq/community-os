import { describe, expect, test } from "bun:test";
// Imported from the pure module, not the service: tech-news.service pulls in
// the database and `env`, which validates at import time and throws when the
// test runner hasn't loaded apps/api/.env.
import { dailyCache, sgtDayKey } from "./daily-cache";

/** A loader that counts invocations and resolves when told to. */
function countingLoader<T>(value: T) {
  let calls = 0;
  return {
    load: async () => {
      calls++;
      return value;
    },
    get calls() {
      return calls;
    },
  };
}

describe("sgtDayKey", () => {
  test("formats as YYYY-MM-DD in Singapore time", () => {
    expect(sgtDayKey(new Date("2026-08-21T12:00:00Z"))).toBe("2026-08-21");
  });

  test("rolls over at midnight SGT, not UTC", () => {
    // 16:00Z is midnight SGT — already the next Singapore day.
    expect(sgtDayKey(new Date("2026-08-21T15:59:00Z"))).toBe("2026-08-21");
    expect(sgtDayKey(new Date("2026-08-21T16:00:00Z"))).toBe("2026-08-22");
  });
});

describe("dailyCache", () => {
  const DAY_1 = new Date("2026-08-21T02:00:00Z");
  const DAY_2 = new Date("2026-08-22T02:00:00Z");

  test("loads once, then serves the cached value", async () => {
    const loader = countingLoader("news");
    const get = dailyCache(loader.load);

    expect(await get({ now: DAY_1 })).toBe("news");
    expect(await get({ now: DAY_1 })).toBe("news");
    expect(await get({ now: DAY_1 })).toBe("news");
    expect(loader.calls).toBe(1);
  });

  test("regenerates on a new Singapore day", async () => {
    const loader = countingLoader("news");
    const get = dailyCache(loader.load);

    await get({ now: DAY_1 });
    await get({ now: DAY_2 });
    expect(loader.calls).toBe(2);
  });

  test("force bypasses the cache", async () => {
    const loader = countingLoader("news");
    const get = dailyCache(loader.load);

    await get({ now: DAY_1 });
    await get({ now: DAY_1, force: true });
    expect(loader.calls).toBe(2);
  });

  test("caches null, so a quiet day isn't re-generated", async () => {
    const loader = countingLoader(null);
    const get = dailyCache(loader.load);

    expect(await get({ now: DAY_1 })).toBeNull();
    expect(await get({ now: DAY_1 })).toBeNull();
    expect(loader.calls).toBe(1);
  });

  test("collapses concurrent callers onto one load", async () => {
    let calls = 0;
    let release: (v: string) => void = () => {};
    const get = dailyCache(() => {
      calls++;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });

    // Spam the command before the first generation finishes.
    const all = Promise.all([
      get({ now: DAY_1 }),
      get({ now: DAY_1 }),
      get({ now: DAY_1 }),
    ]);
    release("news");

    expect(await all).toEqual(["news", "news", "news"]);
    expect(calls).toBe(1);
  });

  test("does not cache a rejection", async () => {
    let calls = 0;
    const get = dailyCache(async () => {
      calls++;
      if (calls === 1) throw new Error("exa down");
      return "news";
    });

    await expect(get({ now: DAY_1 })).rejects.toThrow("exa down");
    // The failure must not poison the day.
    expect(await get({ now: DAY_1 })).toBe("news");
    expect(calls).toBe(2);
  });

  test("a rejection does not leave callers stuck on the dead promise", async () => {
    let calls = 0;
    const get = dailyCache(async () => {
      calls++;
      throw new Error("down");
    });

    await expect(get({ now: DAY_1 })).rejects.toThrow();
    await expect(get({ now: DAY_1 })).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
