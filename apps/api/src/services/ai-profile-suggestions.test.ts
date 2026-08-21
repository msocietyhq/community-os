import { describe, expect, test } from "bun:test";
import {
  additiveKey,
  scalarKey,
  visibleSuggestions,
  keyedSuggestions,
  DISMISSAL_TTL_DAYS,
} from "./ai-profile-suggestions";

const NOW = new Date("2026-08-21T00:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const EMPTY = {
  bio: null,
  skills: null,
  interests: null,
  currentCompany: null,
  currentTitle: null,
  education: null,
};

describe("key scoping", () => {
  test("additive keys are value-scoped and normalized", () => {
    expect(additiveKey("skills", "  Rust  ")).toBe("skills:rust");
    expect(additiveKey("skills", "RUST")).toBe(additiveKey("skills", "rust"));
  });

  test("additive keys for different values differ", () => {
    expect(additiveKey("skills", "rust")).not.toBe(additiveKey("skills", "go"));
  });

  test("scalar keys hash the suggestion, so different text resurfaces", () => {
    expect(scalarKey("bio", "Backend infra")).not.toBe(
      scalarKey("bio", "Frontend design"),
    );
  });

  test("scalar keys are stable for identical text", () => {
    expect(scalarKey("bio", "Backend infra")).toBe(
      scalarKey("bio", "backend  infra"),
    );
  });
});

describe("visibleSuggestions — source of truth", () => {
  test("a field the member authored is never suggested for", () => {
    const result = visibleSuggestions(
      { bio: "AI-written bio" },
      { ...EMPTY, bio: "My own bio" },
      [],
      NOW,
    );
    expect(result.bio).toBeUndefined();
  });

  test("an empty field is suggested for", () => {
    const result = visibleSuggestions({ bio: "AI-written bio" }, EMPTY, [], NOW);
    expect(result.bio).toBe("AI-written bio");
  });

  test("an authored field that is only whitespace still counts as empty", () => {
    const result = visibleSuggestions(
      { bio: "AI-written bio" },
      { ...EMPTY, bio: "   " },
      [],
      NOW,
    );
    expect(result.bio).toBe("AI-written bio");
  });

  test("additive fields suggest only values the member lacks", () => {
    const result = visibleSuggestions(
      { skills: ["Postgres", "Bun", "Drizzle"] },
      { ...EMPTY, skills: ["postgres"] },
      [],
      NOW,
    );
    expect(result.skills).toEqual(["Bun", "Drizzle"]);
  });

  test("an additive field with nothing new to add is omitted", () => {
    const result = visibleSuggestions(
      { skills: ["Postgres"] },
      { ...EMPTY, skills: ["Postgres"] },
      [],
      NOW,
    );
    expect(result.skills).toBeUndefined();
  });
});

describe("visibleSuggestions — dismissals", () => {
  test("a dismissed additive value stays suppressed", () => {
    const result = visibleSuggestions(
      { skills: ["Rust", "Go"] },
      EMPTY,
      [{ key: additiveKey("skills", "Rust"), at: daysAgo(1) }],
      NOW,
    );
    expect(result.skills).toEqual(["Go"]);
  });

  test("a dismissed scalar suggestion stays suppressed when re-derived identically", () => {
    const result = visibleSuggestions(
      { bio: "Backend infra" },
      EMPTY,
      [{ key: scalarKey("bio", "Backend infra"), at: daysAgo(1) }],
      NOW,
    );
    expect(result.bio).toBeUndefined();
  });

  test("a differently-worded scalar suggestion resurfaces", () => {
    const result = visibleSuggestions(
      { bio: "Community organiser and backend engineer" },
      EMPTY,
      [{ key: scalarKey("bio", "Backend infra"), at: daysAgo(1) }],
      NOW,
    );
    expect(result.bio).toBe("Community organiser and backend engineer");
  });

  test("a dismissal older than the TTL expires", () => {
    const result = visibleSuggestions(
      { skills: ["Kubernetes"] },
      EMPTY,
      [
        {
          key: additiveKey("skills", "Kubernetes"),
          at: daysAgo(DISMISSAL_TTL_DAYS + 1),
        },
      ],
      NOW,
    );
    expect(result.skills).toEqual(["Kubernetes"]);
  });

  test("a dismissal just inside the TTL still applies", () => {
    const result = visibleSuggestions(
      { skills: ["Kubernetes"] },
      EMPTY,
      [
        {
          key: additiveKey("skills", "Kubernetes"),
          at: daysAgo(DISMISSAL_TTL_DAYS - 1),
        },
      ],
      NOW,
    );
    expect(result.skills).toBeUndefined();
  });

  test("an unparseable timestamp is treated as expired, not eternal", () => {
    const result = visibleSuggestions(
      { skills: ["Rust"] },
      EMPTY,
      [{ key: additiveKey("skills", "Rust"), at: "not-a-date" }],
      NOW,
    );
    expect(result.skills).toEqual(["Rust"]);
  });
});

describe("visibleSuggestions — degenerate input", () => {
  test("null suggestions → empty result", () => {
    expect(visibleSuggestions(null, EMPTY, [], NOW)).toEqual({});
  });

  test("empty suggestions → empty result", () => {
    expect(visibleSuggestions({}, EMPTY, [], NOW)).toEqual({});
  });

  test("blank suggested values are dropped", () => {
    expect(visibleSuggestions({ bio: "   " }, EMPTY, [], NOW)).toEqual({});
  });
});

describe("keyedSuggestions", () => {
  test("no suggestions → empty list", () => {
    expect(keyedSuggestions({})).toEqual([]);
  });

  test("a scalar field yields one value and one hashed key", () => {
    const [entry] = keyedSuggestions({ bio: "Backend infra" });
    expect(entry?.field).toBe("bio");
    expect(entry?.display).toBe("Backend infra");
    expect(entry?.values).toEqual(["Backend infra"]);
    expect(entry?.keys).toEqual([scalarKey("bio", "Backend infra")]);
  });

  test("an additive field joins for display but keys each value", () => {
    const [entry] = keyedSuggestions({ skills: ["Rust", "Go"] });
    expect(entry?.field).toBe("skills");
    expect(entry?.display).toBe("Rust, Go");
    expect(entry?.values).toEqual(["Rust", "Go"]);
    expect(entry?.keys).toEqual([
      additiveKey("skills", "Rust"),
      additiveKey("skills", "Go"),
    ]);
  });

  test("scalar fields come before additive ones", () => {
    const entries = keyedSuggestions({
      skills: ["Rust"],
      bio: "Backend infra",
    });
    expect(entries.map((e) => e.field)).toEqual(["bio", "skills"]);
  });

  test("every suggested field is represented exactly once", () => {
    const entries = keyedSuggestions({
      bio: "b",
      currentCompany: "c",
      currentTitle: "t",
      education: "e",
      skills: ["s"],
      interests: ["i"],
    });
    expect(entries).toHaveLength(6);
    expect(new Set(entries.map((e) => e.field)).size).toBe(6);
  });
});
