import { describe, expect, test } from "bun:test";
import { MEMBER_SELF_COLUMNS } from "../db/schema/members";

describe("MEMBER_SELF_COLUMNS", () => {
  test("never exposes the embedding", () => {
    // 512 floats must not reach a browser or an audit row. This column list
    // feeds GET /me and the PATCH /me audit payload.
    expect(Object.keys(MEMBER_SELF_COLUMNS)).not.toContain("aiEmbedding");
  });

  test("never exposes the generated summary", () => {
    // The summary is the AI's retrieval key, read through GraphQL only.
    expect(Object.keys(MEMBER_SELF_COLUMNS)).not.toContain("aiSummary");
  });

  test("still exposes the suggestions the profile editors need", () => {
    expect(Object.keys(MEMBER_SELF_COLUMNS)).toContain("aiSuggested");
    expect(Object.keys(MEMBER_SELF_COLUMNS)).toContain("aiDismissed");
  });

  test("still exposes the hand-authored profile fields", () => {
    for (const field of [
      "bio",
      "skills",
      "interests",
      "currentCompany",
      "currentTitle",
      "education",
      "githubHandle",
      "linkedinUrl",
      "websiteUrl",
    ]) {
      expect(Object.keys(MEMBER_SELF_COLUMNS)).toContain(field);
    }
  });
});
