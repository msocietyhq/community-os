import { Elysia } from "elysia";
import {
  createEventSchema,
  rsvpSchema,
  createPledgeSchema,
} from "@community-os/shared/validators";

export const eventModel = new Elysia({ name: "model.event" }).model({
  "event.create": createEventSchema,
  "event.rsvp": rsvpSchema,
  "event.pledge.create": createPledgeSchema,
});
