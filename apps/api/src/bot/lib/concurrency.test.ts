import { describe, expect, test } from "bun:test";
import { concurrencyKey } from "./concurrency";

describe("concurrencyKey", () => {
  test("the same chat shares a key", () => {
    expect(concurrencyKey({ chat: { id: 42 } })).toBe("42");
    expect(concurrencyKey({ chat: { id: 42 } })).toBe(
      concurrencyKey({ chat: { id: 42 } }),
    );
  });

  test("different chats do not share a key", () => {
    expect(concurrencyKey({ chat: { id: 1 } })).not.toBe(
      concurrencyKey({ chat: { id: 2 } }),
    );
  });

  test("a missing chat is unconstrained", () => {
    expect(concurrencyKey({})).toBeUndefined();
  });
});
