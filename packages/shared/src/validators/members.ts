import { z } from "zod";
import { paginationSchema } from "./common";

export const memberListQuerySchema = paginationSchema.extend({
  q: z.string().optional(),
  role: z.string().optional(),
  skills: z.string().optional(),
  interests: z.string().optional(),
});

export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

export const createMemberSchema = z.object({
  bio: z.string().max(500).optional(),
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  githubHandle: z.string().optional(),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  githubHandle: z.string().optional(),
  phoneNumber: z.string().optional(),
  bio: z.string().max(500).optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  currentCompany: z.string().optional(),
  currentTitle: z.string().optional(),
  education: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/**
 * AI-derived candidate values for a member's profile fields.
 *
 * These are suggestions a member may accept while editing — never facts. The
 * hand-authored `members` row always wins.
 */
export const aiSuggestedSchema = z.object({
  bio: z.string().max(500).optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  currentCompany: z.string().optional(),
  currentTitle: z.string().optional(),
  education: z.string().optional(),
});

export type AiSuggested = z.infer<typeof aiSuggestedSchema>;

/**
 * A suggestion the member waved off, and when.
 *
 * Persists across regeneration — the nightly job re-derives the same facts from
 * the same history, so resetting would return every dismissal the next day.
 * `at` drives the expiry that stops a stale dismissal suppressing a
 * now-accurate suggestion.
 */
export const dismissedEntrySchema = z.object({
  key: z.string(),
  at: z.string().datetime(),
});

export type DismissedEntry = z.infer<typeof dismissedEntrySchema>;

export const dismissSuggestionsSchema = z.object({
  keys: z.array(z.string()).min(1).max(50),
});

export type DismissSuggestionsInput = z.infer<typeof dismissSuggestionsSchema>;

export const banMemberSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type BanMemberInput = z.infer<typeof banMemberSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(["member", "admin"]),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
