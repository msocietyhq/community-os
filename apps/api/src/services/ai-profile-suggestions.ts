/**
 * Which AI suggestions a member actually sees.
 *
 * Kept free of DB/network imports so it can be unit tested in isolation.
 *
 * Two filters apply, in order:
 *   1. Source of truth — a field the member authored is never suggested for.
 *   2. Dismissals — what they waved off stays quiet, subject to a TTL.
 */
import { createHash } from "node:crypto";
import type {
  AiSuggested,
  DismissedEntry,
} from "@community-os/shared/validators";

/** Fields holding one value the member either takes or doesn't. */
export const SCALAR_FIELDS = [
  "bio",
  "currentCompany",
  "currentTitle",
  "education",
] as const;

/** Fields accumulating values, where a suggestion is a set of additions. */
export const ADDITIVE_FIELDS = ["skills", "interests"] as const;

/** ~6 months. Without expiry, a March dismissal outlives the evidence behind it. */
export const DISMISSAL_TTL_DAYS = 182;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Identifies a dismissed additive value, e.g. `skills:rust`. */
export function additiveKey(field: string, value: string): string {
  return `${field}:${normalizeValue(value)}`;
}

/**
 * Identifies a dismissed scalar suggestion, e.g. `bio:a3f1e2d0`. Hashing the
 * text (not the field name) means a reworded regeneration surfaces again rather
 * than "never offer a bio again" — at the cost of trivial rewords resurfacing.
 */
export function scalarKey(field: string, suggestion: string): string {
  const hash = createHash("sha256")
    .update(normalizeValue(suggestion))
    .digest("hex")
    .slice(0, 8);
  return `${field}:${hash}`;
}

/** Dismissal keys still within the TTL. */
export function activeDismissals(
  dismissed: DismissedEntry[],
  now: Date,
): Set<string> {
  const cutoff = now.getTime() - DISMISSAL_TTL_DAYS * MS_PER_DAY;
  return new Set(
    dismissed
      .filter((d) => {
        const at = Date.parse(d.at);
        // An unparseable timestamp is treated as expired rather than eternal.
        return Number.isFinite(at) && at >= cutoff;
      })
      .map((d) => d.key),
  );
}

/** The member's own values, as stored on the `members` row. */
export interface AuthoredProfile {
  bio: string | null;
  skills: string[] | null;
  interests: string[] | null;
  currentCompany: string | null;
  currentTitle: string | null;
  education: string | null;
}

export type VisibleSuggestions = AiSuggested;

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

/**
 * Filter raw suggestions down to what's worth showing this member.
 */
export function visibleSuggestions(
  suggested: AiSuggested | null,
  authored: AuthoredProfile,
  dismissed: DismissedEntry[],
  now: Date = new Date(),
): VisibleSuggestions {
  if (!suggested) return {};

  const active = activeDismissals(dismissed, now);
  const result: VisibleSuggestions = {};

  for (const field of SCALAR_FIELDS) {
    const value = suggested[field];
    if (isBlank(value)) continue;
    // Source of truth: the member already answered this one.
    if (!isBlank(authored[field])) continue;
    if (active.has(scalarKey(field, value as string))) continue;
    result[field] = value as string;
  }

  for (const field of ADDITIVE_FIELDS) {
    const values = suggested[field];
    if (!values?.length) continue;

    const held = new Set((authored[field] ?? []).map(normalizeValue));
    const additions = values.filter((v) => {
      if (isBlank(v)) return false;
      if (held.has(normalizeValue(v))) return false;
      return !active.has(additiveKey(field, v));
    });

    if (additions.length) result[field] = additions;
  }

  return result;
}

/**
 * A suggestion in the shape an API client can render and act on.
 *
 * Clients never compute keys — `scalarKey` hashes server-side, and duplicating
 * the filter in the browser would mean two implementations to keep in step.
 */
export interface SuggestionEntry {
  field: (typeof SCALAR_FIELDS)[number] | (typeof ADDITIVE_FIELDS)[number];
  /** Ready to render. Additive fields are comma-joined. */
  display: string;
  /** One entry for scalar fields, several for additive ones. */
  values: string[];
  /** Opaque dismissal keys — post these back to dismiss the whole entry. */
  keys: string[];
}

/** Flatten filtered suggestions into a client-facing list, scalars first. */
export function keyedSuggestions(
  visible: VisibleSuggestions,
): SuggestionEntry[] {
  const entries: SuggestionEntry[] = [];

  for (const field of SCALAR_FIELDS) {
    const value = visible[field];
    if (!value) continue;
    entries.push({
      field,
      display: value,
      values: [value],
      keys: [scalarKey(field, value)],
    });
  }

  for (const field of ADDITIVE_FIELDS) {
    const values = visible[field];
    if (!values?.length) continue;
    entries.push({
      field,
      display: values.join(", "),
      values,
      keys: values.map((v) => additiveKey(field, v)),
    });
  }

  return entries;
}
