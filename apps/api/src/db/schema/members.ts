import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { vector } from "../types";
import type {
  AiSuggested,
  DismissedEntry,
} from "@community-os/shared/validators";

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  githubHandle: text("github_handle"),
  phoneNumber: text("phone_number"),
  bio: text("bio"),
  skills: text("skills").array(),
  interests: text("interests").array(),
  currentCompany: text("current_company"),
  currentTitle: text("current_title"),
  education: text("education"),
  linkedinUrl: text("linkedin_url"),
  websiteUrl: text("website_url"),
  reputationScore: integer("reputation_score").notNull().default(0),
  joinedAt: timestamp("joined_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),

  // --- AI-derived profile (never rendered publicly; see the design spec) ---
  /** Prose written for retrieval, read by the AI only. */
  aiSummary: text("ai_summary"),
  /** Candidate field values offered while the member edits their profile. */
  aiSuggested: jsonb("ai_suggested").$type<AiSuggested>(),
  /** Embedding of `aiSummary`. MUST NOT be returned from any route. */
  aiEmbedding: vector("ai_embedding", { dimensions: 512 }),
  aiGeneratedAt: timestamp("ai_generated_at"),
  /** Generator version. Bumping PROMPT_VERSION marks older profiles stale. */
  aiPromptVersion: integer("ai_prompt_version").notNull().default(0),
  /** Suggestions the member waved off. Persists across regeneration. */
  aiDismissed: jsonb("ai_dismissed")
    .$type<DismissedEntry[]>()
    .notNull()
    .default([]),
});

/**
 * Columns for a member's own record. Enumerated, not `select *`: `ai_embedding`
 * is 512 floats that must never reach a browser or an audit row. Feeds both
 * `GET /me` and the `PATCH /me` audit payload.
 *
 * Lives here, not members.service.ts, so the guard test can import it without
 * pulling in `env` and the bot.
 */
export const MEMBER_SELF_COLUMNS = {
  id: members.id,
  userId: members.userId,
  githubHandle: members.githubHandle,
  phoneNumber: members.phoneNumber,
  bio: members.bio,
  skills: members.skills,
  interests: members.interests,
  currentCompany: members.currentCompany,
  currentTitle: members.currentTitle,
  education: members.education,
  linkedinUrl: members.linkedinUrl,
  websiteUrl: members.websiteUrl,
  reputationScore: members.reputationScore,
  joinedAt: members.joinedAt,
  createdAt: members.createdAt,
  updatedAt: members.updatedAt,
  aiSuggested: members.aiSuggested,
  aiDismissed: members.aiDismissed,
  aiGeneratedAt: members.aiGeneratedAt,
} as const;
