import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

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
  joinedAt: timestamp("joined_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
