import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { eventModel } from "./models/event";

export const eventRoutes = new Elysia({ prefix: "/api/v1/events" })
  .use(authMiddleware)
  .use(eventModel)
  .get(
    "/",
    async () => {
      // TODO: Implement event listing with filters
      return { events: [], total: 0 };
    },
    {
      detail: { tags: ["Events"], summary: "List events" },
    }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      // TODO: Implement get event by ID
      return { id };
    },
    {
      detail: { tags: ["Events"], summary: "Get event by ID" },
    }
  )
  .post(
    "/",
    async ({ body, user }) => {
      // TODO: Implement event creation
      return { message: "Event created", event: body };
    },
    {
      auth: true,
      body: "event.create",
      detail: { tags: ["Events"], summary: "Create event" },
    }
  )
  .post(
    "/:id/rsvp",
    async ({ params: { id }, body, user }) => {
      // TODO: Implement RSVP
      return { message: "RSVP recorded" };
    },
    {
      auth: true,
      body: "event.rsvp",
      detail: { tags: ["Events"], summary: "RSVP to event" },
    }
  )
  .post(
    "/:id/check-in",
    async ({ params: { id }, body, user }) => {
      // TODO: Implement check-in
      return { message: "Checked in" };
    },
    {
      auth: true,
      detail: { tags: ["Events"], summary: "Check in to event" },
    }
  )
  .post(
    "/:id/pledges",
    async ({ params: { id }, body, user }) => {
      // TODO: Implement pledge creation
      return { message: "Pledge created" };
    },
    {
      auth: true,
      body: "event.pledge.create",
      detail: { tags: ["Events"], summary: "Create pledge for event" },
    }
  );
