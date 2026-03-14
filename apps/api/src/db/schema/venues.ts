import {
  pgTable,
  uuid,
  text,
  integer,
  decimal,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city").default("Singapore"),
  country: text("country").default("SG"),
  postalCode: text("postal_code"),
  mapsUrl: text("maps_url"),
  capacity: integer("capacity"),
  costPerDay: decimal("cost_per_day", { precision: 10, scale: 2 }),
  costNotes: text("cost_notes"),
  notes: text("notes"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
