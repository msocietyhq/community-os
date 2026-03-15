import { z } from "zod";
import {
  EVENT_TYPES,
  EVENT_STATUSES,
  RSVP_STATUSES,
  PLEDGE_STATUSES,
} from "../constants";

export const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  eventType: z.enum(EVENT_TYPES),
  venueId: z.string().uuid().optional(),
  isOnline: z.boolean().default(false),
  onlineUrl: z.string().url().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  maxAttendees: z.number().int().positive().optional(),
  budgetTarget: z.number().positive().optional(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  status: z.enum(EVENT_STATUSES).optional(),
});

export const rsvpSchema = z.object({
  rsvpStatus: z.enum(RSVP_STATUSES),
});

export const createPledgeSchema = z.object({
  amount: z.number().positive(),
  notes: z.string().optional(),
});

export const updatePledgeStatusSchema = z.object({
  status: z.enum(PLEDGE_STATUSES),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RsvpInput = z.infer<typeof rsvpSchema>;
export type CreatePledgeInput = z.infer<typeof createPledgeSchema>;
