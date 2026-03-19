import { eq, and, isNull, gt, lte, count, desc, asc, sql, or } from "drizzle-orm";
import { db } from "../db";
import { events, eventAttendees } from "../db/schema/events";
import { venues } from "../db/schema/venues";
import { account } from "../db/schema/auth";
import { user } from "../db/schema/auth";
import { AppError } from "../lib/errors";
import type {
  CreateEventInput,
  UpdateEventInput,
  EventListQuery,
  CheckInInput,
} from "@community-os/shared/validators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/** Resolve an ID-or-slug to a UUID. */
async function resolveEventId(idOrSlug: string): Promise<string> {
  const condition = UUID_RE.test(idOrSlug)
    ? eq(events.id, idOrSlug)
    : eq(events.slug, idOrSlug);

  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(condition, isNull(events.deletedAt)));

  if (!row) {
    throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  }
  return row.id;
}

export const eventsService = {
  async create(input: CreateEventInput, createdBy: string) {
    const slug = generateSlug(input.title);

    const [event] = await db
      .insert(events)
      .values({
        title: input.title,
        slug,
        description: input.description,
        eventType: input.eventType,
        venueId: input.venueId,
        isOnline: input.isOnline,
        onlineUrl: input.onlineUrl,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        maxAttendees: input.maxAttendees,
        budgetTarget: input.budgetTarget?.toString(),
        createdBy,
      })
      .returning();

    return event;
  },

  async list(query: EventListQuery, userRole: string) {
    const conditions = [isNull(events.deletedAt)];

    if (query.status) {
      conditions.push(eq(events.status, query.status));
    } else if (userRole === "member") {
      conditions.push(or(eq(events.status, "published"), eq(events.status, "completed"))!);
    }

    if (query.eventType) {
      conditions.push(eq(events.eventType, query.eventType));
    }

    if (query.startsAfter) {
      conditions.push(gt(events.startsAt, query.startsAfter));
    }
    if (query.startsBefore) {
      conditions.push(lte(events.startsAt, query.startsBefore));
    }

    const where = and(...conditions);
    const offset = (query.page - 1) * query.limit;

    const orderBy =
      query.startsBefore && !query.startsAfter
        ? [desc(events.startsAt)]
        : [asc(events.startsAt)];

    const [eventList, totalResult] = await Promise.all([
      db.select().from(events).where(where).orderBy(...orderBy).limit(query.limit).offset(offset),
      db.select({ total: count() }).from(events).where(where),
    ]);

    return { events: eventList, total: totalResult[0]?.total ?? 0 };
  },

  async getById(idOrSlug: string) {
    const condition = UUID_RE.test(idOrSlug)
      ? eq(events.id, idOrSlug)
      : eq(events.slug, idOrSlug);

    const [event] = await db
      .select()
      .from(events)
      .where(and(condition, isNull(events.deletedAt)));

    if (!event) {
      throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    const countResult = await db
      .select({ attendeeCount: count() })
      .from(eventAttendees)
      .where(
        and(
          eq(eventAttendees.eventId, event.id),
          eq(eventAttendees.rsvpStatus, "going"),
        ),
      );

    return { ...event, attendeeCount: countResult[0]?.attendeeCount ?? 0 };
  },

  async getBySlug(slug: string) {
    const [event] = await db
      .select()
      .from(events)
      .where(and(eq(events.slug, slug), isNull(events.deletedAt)));

    if (!event) {
      throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    const countResult = await db
      .select({ attendeeCount: count() })
      .from(eventAttendees)
      .where(
        and(
          eq(eventAttendees.eventId, event.id),
          eq(eventAttendees.rsvpStatus, "going"),
        ),
      );

    return { ...event, attendeeCount: countResult[0]?.attendeeCount ?? 0 };
  },

  async listUpcoming(limit = 5) {
    const attendeeCountSq = db
      .select({
        eventId: eventAttendees.eventId,
        attendeeCount: count().as("attendee_count"),
      })
      .from(eventAttendees)
      .where(eq(eventAttendees.rsvpStatus, "going"))
      .groupBy(eventAttendees.eventId)
      .as("attendee_counts");

    const maybeCountSq = db
      .select({
        eventId: eventAttendees.eventId,
        maybeCount: count().as("maybe_count"),
      })
      .from(eventAttendees)
      .where(eq(eventAttendees.rsvpStatus, "maybe"))
      .groupBy(eventAttendees.eventId)
      .as("maybe_counts");

    const rows = await db
      .select({
        event: events,
        venueName: venues.name,
        attendeeCount: sql<number>`coalesce(${attendeeCountSq.attendeeCount}, 0)`.mapWith(Number),
        maybeCount: sql<number>`coalesce(${maybeCountSq.maybeCount}, 0)`.mapWith(Number),
      })
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .leftJoin(attendeeCountSq, eq(events.id, attendeeCountSq.eventId))
      .leftJoin(maybeCountSq, eq(events.id, maybeCountSq.eventId))
      .where(
        and(
          eq(events.status, "published"),
          gt(events.startsAt, new Date()),
          isNull(events.deletedAt),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row.event,
      venueName: row.venueName,
      attendeeCount: row.attendeeCount,
      maybeCount: row.maybeCount,
    }));
  },

  async update(idOrSlug: string, input: UpdateEventInput) {
    const id = await resolveEventId(idOrSlug);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.eventType !== undefined) updateData.eventType = input.eventType;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.venueId !== undefined) updateData.venueId = input.venueId;
    if (input.isOnline !== undefined) updateData.isOnline = input.isOnline;
    if (input.onlineUrl !== undefined) updateData.onlineUrl = input.onlineUrl;
    if (input.startsAt !== undefined)
      updateData.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined) updateData.endsAt = new Date(input.endsAt);
    if (input.maxAttendees !== undefined)
      updateData.maxAttendees = input.maxAttendees;
    if (input.budgetTarget !== undefined)
      updateData.budgetTarget = input.budgetTarget.toString();

    const [updated] = await db
      .update(events)
      .set(updateData)
      .where(eq(events.id, id))
      .returning();

    return updated;
  },

  async cancel(idOrSlug: string) {
    const id = await resolveEventId(idOrSlug);

    const [cancelled] = await db
      .update(events)
      .set({ status: "cancelled", deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning();

    return cancelled;
  },

  async rsvp(eventIdOrSlug: string, userId: string, rsvpStatus: string) {
    const eventId = await resolveEventId(eventIdOrSlug);

    const [event] = await db
      .select({ id: events.id, status: events.status, maxAttendees: events.maxAttendees })
      .from(events)
      .where(eq(events.id, eventId));

    if (!event) {
      throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    if (event.status !== "published") {
      throw new AppError(400, "EVENT_NOT_PUBLISHED", "Event is not open for RSVPs");
    }

    if (rsvpStatus === "going" && event.maxAttendees) {
      const goingResult = await db
        .select({ goingCount: count() })
        .from(eventAttendees)
        .where(
          and(
            eq(eventAttendees.eventId, eventId),
            eq(eventAttendees.rsvpStatus, "going"),
          ),
        );
      const goingCount = goingResult[0]?.goingCount ?? 0;

      if (goingCount >= event.maxAttendees) {
        throw new AppError(409, "EVENT_FULL", "Event has reached maximum capacity");
      }
    }

    const [attendee] = await db
      .insert(eventAttendees)
      .values({
        eventId,
        userId,
        rsvpStatus: rsvpStatus as "going" | "maybe" | "not_going",
      })
      .onConflictDoUpdate({
        target: [eventAttendees.eventId, eventAttendees.userId],
        set: {
          rsvpStatus: rsvpStatus as "going" | "maybe" | "not_going",
          updatedAt: new Date(),
        },
      })
      .returning();

    return attendee;
  },

  async listAttendees(eventId: string) {
    const attendees = await db
      .select({
        id: eventAttendees.id,
        rsvpStatus: eventAttendees.rsvpStatus,
        attended: eventAttendees.attended,
        checkedInAt: eventAttendees.checkedInAt,
        createdAt: eventAttendees.createdAt,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(eventAttendees)
      .innerJoin(user, eq(eventAttendees.userId, user.id))
      .where(eq(eventAttendees.eventId, eventId));

    return attendees;
  },

  async checkIn(eventIdOrSlug: string, input: CheckInInput) {
    const eventId = await resolveEventId(eventIdOrSlug);

    const [event] = await db
      .select({ id: events.id, status: events.status })
      .from(events)
      .where(eq(events.id, eventId));

    if (!event) {
      throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    if (event.status !== "published" && event.status !== "completed") {
      throw new AppError(400, "EVENT_NOT_ACTIVE", "Event is not active for check-ins");
    }

    let userId = input.userId;

    if (input.telegramId && !userId) {
      const [acct] = await db
        .select({ userId: account.userId })
        .from(account)
        .where(
          and(
            eq(account.providerId, "telegram"),
            eq(account.accountId, input.telegramId),
          ),
        );

      if (!acct) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "No user found with that Telegram ID");
      }

      userId = acct.userId;
    }

    if (!userId) {
      throw new AppError(400, "USER_ID_REQUIRED", "Could not resolve user ID");
    }

    const [existing] = await db
      .select()
      .from(eventAttendees)
      .where(
        and(
          eq(eventAttendees.eventId, eventId),
          eq(eventAttendees.userId, userId),
        ),
      );

    if (existing) {
      const [updated] = await db
        .update(eventAttendees)
        .set({
          attended: true,
          checkedInAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(eventAttendees.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await db
      .insert(eventAttendees)
      .values({
        eventId,
        userId,
        rsvpStatus: "going",
        attended: true,
        checkedInAt: new Date(),
      })
      .returning();

    return created;
  },
};
