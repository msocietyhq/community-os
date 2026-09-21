import { describe, expect, test } from "bun:test";
import { createTransactionSchema } from "./funds";

const base = {
  currency: "SGD",
  description: "test",
  categoryId: "00000000-0000-0000-0000-000000000000",
  occurredAt: "2026-09-01T00:00:00.000Z",
};

describe("createTransactionSchema", () => {
  test("rejects a non-positive amount for expense", () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      type: "expense",
      amount: -50,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a zero amount even for adjustment", () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      type: "adjustment",
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  test("accepts a negative amount for adjustment", () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      type: "adjustment",
      amount: -20,
    });
    expect(result.success).toBe(true);
  });

  test("accepts a positive amount for pledge_collection", () => {
    const result = createTransactionSchema.safeParse({
      ...base,
      type: "pledge_collection",
      amount: 100,
    });
    expect(result.success).toBe(true);
  });
});
