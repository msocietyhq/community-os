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
  event_type: z.enum(EVENT_TYPES),
  venue_id: z.string().uuid().optional(),
  is_online: z.boolean().default(false),
  online_url: z.string().url().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional(),
  max_attendees: z.number().int().positive().optional(),
  budget_target: z.number().positive().optional(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  status: z.enum(EVENT_STATUSES).optional(),
});

export const rsvpSchema = z.object({
  rsvp_status: z.enum(RSVP_STATUSES),
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
