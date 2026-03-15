import { eq, count, desc, ilike, or, and } from "drizzle-orm";
import { db } from "../db";
import { venues } from "../db/schema/venues";
import { AppError } from "../lib/errors";
import type {
  CreateVenueInput,
  UpdateVenueInput,
  VenueListQuery,
} from "@community-os/shared/validators";

export const venuesService = {
  async create(input: CreateVenueInput, createdBy: string) {
    const [venue] = await db
      .insert(venues)
      .values({
        name: input.name,
        address: input.address,
        city: input.city,
        country: input.country,
        postalCode: input.postalCode,
        mapsUrl: input.mapsUrl,
        capacity: input.capacity,
        costPerDay: input.costPerDay?.toString(),
        costNotes: input.costNotes,
        notes: input.notes,
        createdBy,
      })
      .returning();

    return venue;
  },

  async list(query: VenueListQuery) {
    const conditions = [];

    if (query.q) {
      conditions.push(
        or(
          ilike(venues.name, `%${query.q}%`),
          ilike(venues.address, `%${query.q}%`),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.limit;

    const [venueList, totalResult] = await Promise.all([
      db
        .select()
        .from(venues)
        .where(where)
        .orderBy(desc(venues.createdAt))
        .limit(query.limit)
        .offset(offset),
      db.select({ total: count() }).from(venues).where(where),
    ]);

    return { venues: venueList, total: totalResult[0]?.total ?? 0 };
  },

  async getById(id: string) {
    const [venue] = await db
      .select()
      .from(venues)
      .where(eq(venues.id, id));

    if (!venue) {
      throw new AppError(404, "VENUE_NOT_FOUND", "Venue not found");
    }

    return venue;
  },

  async update(id: string, input: UpdateVenueInput) {
    const [existing] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, id));

    if (!existing) {
      throw new AppError(404, "VENUE_NOT_FOUND", "Venue not found");
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.address !== undefined) updateData.address = input.address;
    if (input.city !== undefined) updateData.city = input.city;
    if (input.country !== undefined) updateData.country = input.country;
    if (input.postalCode !== undefined) updateData.postalCode = input.postalCode;
    if (input.mapsUrl !== undefined) updateData.mapsUrl = input.mapsUrl;
    if (input.capacity !== undefined) updateData.capacity = input.capacity;
    if (input.costPerDay !== undefined)
      updateData.costPerDay = input.costPerDay.toString();
    if (input.costNotes !== undefined) updateData.costNotes = input.costNotes;
    if (input.notes !== undefined) updateData.notes = input.notes;

    const [updated] = await db
      .update(venues)
      .set(updateData)
      .where(eq(venues.id, id))
      .returning();

    return updated;
  },

  async remove(id: string) {
    const [existing] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, id));

    if (!existing) {
      throw new AppError(404, "VENUE_NOT_FOUND", "Venue not found");
    }

    const [deleted] = await db
      .delete(venues)
      .where(eq(venues.id, id))
      .returning();

    return deleted;
  },
};
