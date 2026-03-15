import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";
import { eventModel } from "./models/event";
import { eventsService } from "../services/events.service";

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
          beforeHandle: checkPermission("read", "Event"),
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
          beforeHandle: checkPermission("read", "Event"),
          detail: { tags: ["Events"], summary: "Get event by ID" },
        },
      )
      .post(
        "/",
        async ({ body, user }) => {
          const result = await eventsService.create(body, user.id);
          if (result) {
            createAuditEntry({
              entityType: "event",
              entityId: result.id,
              action: "create",
              newValue: result,
              performedBy: user.id,
            }).catch(console.error);
          }
          return result;
        },
        {
          beforeHandle: checkPermission("create", "Event"),
          body: "event.create",
          detail: { tags: ["Events"], summary: "Create event" },
        },
      )
      .patch(
        "/:id",
        async ({ params: { id }, body, user }) => {
          const result = await eventsService.update(id, body);
          createAuditEntry({
            entityType: "event",
            entityId: id,
            action: "update",
            newValue: result,
            performedBy: user.id,
          }).catch(console.error);
          return result;
        },
        {
          beforeHandle: checkPermission("update", "Event"),
          body: "event.update",
          detail: { tags: ["Events"], summary: "Update event" },
        },
      )
      .delete(
        "/:id",
        async ({ params: { id }, user }) => {
          const event = await eventsService.cancel(id);
          createAuditEntry({
            entityType: "event",
            entityId: id,
            action: "delete",
            newValue: event,
            performedBy: user.id,
          }).catch(console.error);
          return { message: "Event cancelled", event };
        },
        {
          beforeHandle: checkPermission("delete", "Event"),
          detail: { tags: ["Events"], summary: "Cancel event" },
        },
      )
      .post(
        "/:id/rsvp",
        async ({ params: { id }, body, user }) => {
          const result = await eventsService.rsvp(id, user.id, body.rsvpStatus);
          createAuditEntry({
            entityType: "event",
            entityId: id,
            action: "update",
            newValue: { rsvpStatus: body.rsvpStatus, userId: user.id },
            performedBy: user.id,
          }).catch(console.error);
          return result;
        },
        {
          beforeHandle: checkPermission("rsvp", "Event"),
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
          beforeHandle: checkPermission("read", "Event"),
          detail: { tags: ["Events"], summary: "List event attendees" },
        },
      )
      .post(
        "/:id/check-in",
        async ({ params: { id }, body, user }) => {
          const result = await eventsService.checkIn(id, body);
          createAuditEntry({
            entityType: "event",
            entityId: id,
            action: "update",
            newValue: result,
            performedBy: user.id,
          }).catch(console.error);
          return result;
        },
        {
          beforeHandle: checkPermission("check_in", "Event"),
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
          beforeHandle: checkPermission("rsvp", "Event"),
          body: "event.pledge.create",
          detail: { tags: ["Events"], summary: "Create pledge for event" },
        },
      ),
  );
