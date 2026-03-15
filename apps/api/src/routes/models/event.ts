import { Elysia } from "elysia";
import {
  createEventSchema,
  updateEventSchema,
  rsvpSchema,
  checkInSchema,
  createPledgeSchema,
  eventListQuerySchema,
} from "@community-os/shared/validators";

export const eventModel = new Elysia({ name: "model.event" }).model({
  "event.create": createEventSchema,
  "event.update": updateEventSchema,
  "event.rsvp": rsvpSchema,
  "event.checkIn": checkInSchema,
  "event.listQuery": eventListQuerySchema,
  "event.pledge.create": createPledgeSchema,
});
