import { describe, expect, test } from "bun:test";
import { curationSchemaForTest } from "./tech-news.service";

describe("curationSchema", () => {
  // Regression: the model omits a section when nothing qualifies, which the
  // prompt explicitly invites it to do. A required array turned that correct
  // answer into a NoObjectGeneratedError and lost the entire roundup — seen in
  // a real run where only `islamic` was missing.
  test("accepts a response with sections omitted", () => {
    const parsed = curationSchemaForTest.parse({
      stories: [{ id: 0, why: "matters" }],
    });

    expect(parsed.stories).toHaveLength(1);
    expect(parsed.repos).toEqual([]);
    expect(parsed.local).toEqual([]);
    expect(parsed.islamic).toEqual([]);
  });

  test("accepts a wholly empty response", () => {
    expect(curationSchemaForTest.parse({})).toEqual({
      stories: [],
      repos: [],
      local: [],
      islamic: [],
    });
  });

  test("keeps every section it is given", () => {
    const pick = (id: number) => [{ id, why: "w" }];
    const parsed = curationSchemaForTest.parse({
      stories: pick(0),
      repos: pick(1),
      local: pick(2),
      islamic: pick(3),
    });

    expect(parsed.stories[0]?.id).toBe(0);
    expect(parsed.repos[0]?.id).toBe(1);
    expect(parsed.local[0]?.id).toBe(2);
    expect(parsed.islamic[0]?.id).toBe(3);
  });

  test("still rejects a malformed pick", () => {
    expect(() =>
      curationSchemaForTest.parse({ stories: [{ id: "nope", why: "x" }] }),
    ).toThrow();
    expect(() =>
      curationSchemaForTest.parse({ stories: [{ id: 1 }] }),
    ).toThrow();
  });
});
