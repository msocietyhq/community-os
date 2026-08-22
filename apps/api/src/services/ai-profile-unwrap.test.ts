import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { generationSchema, unwrapCollapsedProfile } from "./ai-profile.service";

/** Verbatim from a production `NoObjectGeneratedError` (member 54c26d04…). */
const COLLAPSED_FROM_PRODUCTION = {
  suggested:
    '{"summary": "Kai is a cybersecurity researcher and PhD holder/candidate whose work centers on threat intelligence knowledge graphs (e.g. AttacKG, published at ESORICS\'22), vulnerability and risk assessment of computing infrastructure, and security education.", "interests": ["cybersecurity education", "threat intelligence", "knowledge graphs"], "skills": ["cybersecurity", "pentesting", "teaching/mentoring"]}',
};

describe("unwrapCollapsedProfile", () => {
  test("recovers the production payload that threw NoObjectGeneratedError", () => {
    const out = unwrapCollapsedProfile(COLLAPSED_FROM_PRODUCTION) as {
      summary: string;
      suggested: { interests?: string[]; skills?: string[] };
    };

    expect(out.summary).toStartWith("Kai is a cybersecurity researcher");
    expect(out.suggested.interests).toContain("threat intelligence");
    expect(out.suggested.skills).toContain("pentesting");
    // The blob must not survive as a field in its own right.
    expect(typeof out.suggested).toBe("object");
    expect(JSON.stringify(out)).not.toContain('\\"summary\\"');
  });

  test("leaves a well-formed response untouched", () => {
    const good = { summary: "A backend engineer.", suggested: { skills: ["Go"] } };
    expect(unwrapCollapsedProfile(good)).toEqual(good);
  });

  test("is idempotent, since the schema parses twice", () => {
    const once = unwrapCollapsedProfile(COLLAPSED_FROM_PRODUCTION);
    expect(unwrapCollapsedProfile(once)).toEqual(once);
  });

  test("handles the blob arriving under summary instead", () => {
    const out = unwrapCollapsedProfile({
      summary: '{"summary": "A data engineer.", "skills": ["dbt"]}',
    }) as { summary: string; suggested: { skills?: string[] } };

    expect(out.summary).toBe("A data engineer.");
    expect(out.suggested.skills).toEqual(["dbt"]);
  });

  test("keeps a legitimate outer summary over the blob's", () => {
    const out = unwrapCollapsedProfile({
      summary: "The real summary.",
      suggested: '{"summary": "stale", "skills": ["Rust"]}',
    }) as { summary: string; suggested: { skills?: string[] } };

    expect(out.summary).toBe("The real summary.");
    expect(out.suggested.skills).toEqual(["Rust"]);
  });

  test("passes through prose that merely starts with a brace", () => {
    const prose = { summary: "{not json at all", suggested: {} };
    expect(unwrapCollapsedProfile(prose)).toEqual(prose);
  });

  test("passes through non-objects rather than throwing", () => {
    for (const v of [null, undefined, "text", 42, ["a"]]) {
      expect(unwrapCollapsedProfile(v)).toEqual(v);
    }
  });
});

describe("generationSchema", () => {
  test("now accepts the response that crashed the backfill", () => {
    const parsed = generationSchema.parse(COLLAPSED_FROM_PRODUCTION);
    expect(parsed.summary).toStartWith("Kai is a cybersecurity researcher");
    expect(parsed.suggested.skills).toContain("pentesting");
  });

  test("still defaults `suggested` when the model omits it", () => {
    expect(generationSchema.parse({ summary: "Just a summary." })).toEqual({
      summary: "Just a summary.",
      suggested: {},
    });
  });

  test("still rejects a genuinely unusable response", () => {
    expect(() => generationSchema.parse({ suggested: { skills: ["Go"] } })).toThrow();
  });

  test("the model-facing JSON Schema is unchanged by the preprocess", () => {
    const json = z.toJSONSchema(generationSchema, { io: "input" }) as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(["suggested", "summary"]);
  });
});
