import { Elysia } from "elysia";
import { PERMISSIONS } from "@community-os/shared";
import { authMiddleware } from "../middleware/auth";
import { eventModel } from "./models/event";
import { eventsService } from "../services/events.service";

function denyUnless(permission: keyof typeof PERMISSIONS) {
  return ({ user, status }: { user: { role: string }; status: Function }) => {
    const allowed: readonly string[] = PERMISSIONS[permission];
    if (!allowed.includes(user.role)) {
      return status(403, {
        error: {
          code: "FORBIDDEN",
          message: `Insufficient permissions: ${permission} required`,
        },
      });
    }
  };
}

export const eventRoutes = new Elysia({ prefix: "/api/v1/events" })
  .use(authMiddleware)
  .use(eventModel)
  .guard({ auth: true }, (app) =>
    app
      .get(
        "/",
        async ({ query, user }) => {
          return eventsService.list(query, user.role);
        },
        {
          query: "event.listQuery",
          detail: { tags: ["Events"], summary: "List events" },
        },
      )
      .get(
        "/:id",
        async ({ params: { id } }) => {
          return eventsService.getById(id);
        },
        {
          detail: { tags: ["Events"], summary: "Get event by ID" },
        },
      )
      .post(
        "/",
        async ({ body, user }) => {
          return eventsService.create(body, user.id);
        },
        {
          beforeHandle: denyUnless("events:create"),
          body: "event.create",
          detail: { tags: ["Events"], summary: "Create event" },
        },
      )
      .patch(
        "/:id",
        async ({ params: { id }, body }) => {
          return eventsService.update(id, body);
        },
        {
          beforeHandle: denyUnless("events:update"),
          body: "event.update",
          detail: { tags: ["Events"], summary: "Update event" },
        },
      )
      .delete(
        "/:id",
        async ({ params: { id } }) => {
          const event = await eventsService.cancel(id);
          return { message: "Event cancelled", event };
        },
        {
          beforeHandle: denyUnless("events:delete"),
          detail: { tags: ["Events"], summary: "Cancel event" },
        },
      )
      .post(
        "/:id/rsvp",
        async ({ params: { id }, body, user }) => {
          return eventsService.rsvp(id, user.id, body.rsvpStatus);
        },
        {
          body: "event.rsvp",
          detail: { tags: ["Events"], summary: "RSVP to event" },
        },
      )
      .get(
        "/:id/attendees",
        async ({ params: { id } }) => {
          const attendees = await eventsService.listAttendees(id);
          return { attendees };
        },
        {
          detail: { tags: ["Events"], summary: "List event attendees" },
        },
      )
      .post(
        "/:id/check-in",
        async ({ params: { id }, body }) => {
          return eventsService.checkIn(id, body);
        },
        {
          beforeHandle: denyUnless("events:check_in"),
          body: "event.checkIn",
          detail: { tags: ["Events"], summary: "Check in to event" },
        },
      )
      .post(
        "/:id/pledges",
        async ({ params: { id }, body, user }) => {
          // TODO: Implement pledge creation
          return { message: "Pledge created" };
        },
        {
          body: "event.pledge.create",
          detail: { tags: ["Events"], summary: "Create pledge for event" },
        },
      ),
  );
