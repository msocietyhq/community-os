import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  decimal,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { venues } from "./venues";

export const eventTypeEnum = pgEnum("event_type", [
  "meetup",
  "workshop",
  "hackathon",
  "talk",
  "social",
  "other",
]);

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "published",
  "cancelled",
  "completed",
]);

export const rsvpStatusEnum = pgEnum("rsvp_status", [
  "going",
  "maybe",
  "not_going",
]);

export const pledgeStatusEnum = pgEnum("pledge_status", [
  "pledged",
  "fulfilled",
  "cancelled",
]);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  eventType: eventTypeEnum("event_type").notNull(),
  status: eventStatusEnum("status").default("draft"),
  venueId: uuid("venue_id").references(() => venues.id),
  isOnline: boolean("is_online").default(false),
  onlineUrl: text("online_url"),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  maxAttendees: integer("max_attendees"),
  budgetTarget: decimal("budget_target", { precision: 10, scale: 2 }),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const eventAttendees = pgTable(
  "event_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rsvpStatus: rsvpStatusEnum("rsvp_status").notNull(),
    attended: boolean("attended").default(false),
    checkedInAt: timestamp("checked_in_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [unique().on(table.eventId, table.userId)]
);

export const eventPledges = pgTable("event_pledges", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: pledgeStatusEnum("status").default("pledged"),
  fulfilledAt: timestamp("fulfilled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
