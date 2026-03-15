import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";
import { venueModel } from "./models/venue";
import { venuesService } from "../services/venues.service";

export const venueRoutes = new Elysia({ prefix: "/api/v1/venues" })
  .use(authMiddleware)
  .use(venueModel)
  .guard({ auth: true }, (app) =>
    app
      .get(
        "/",
        async ({ query }) => {
          return venuesService.list(query);
        },
        {
          beforeHandle: checkPermission("read", "Venue"),
          query: "venue.listQuery",
          detail: { tags: ["Venues"], summary: "List venues" },
        },
      )
      .get(
        "/:id",
        async ({ params: { id } }) => {
          return venuesService.getById(id);
        },
        {
          beforeHandle: checkPermission("read", "Venue"),
          detail: { tags: ["Venues"], summary: "Get venue by ID" },
        },
      )
      .post(
        "/",
        async ({ body, user }) => {
          const result = await venuesService.create(body, user.id);
          if (result) {
            createAuditEntry({
              entityType: "venue",
              entityId: result.id,
              action: "create",
              newValue: result,
              performedBy: user.id,
            }).catch(console.error);
          }
          return result;
        },
        {
          beforeHandle: checkPermission("create", "Venue"),
          body: "venue.create",
          detail: { tags: ["Venues"], summary: "Create venue" },
        },
      )
      .patch(
        "/:id",
        async ({ params: { id }, body, user }) => {
          const result = await venuesService.update(id, body);
          createAuditEntry({
            entityType: "venue",
            entityId: id,
            action: "update",
            newValue: result,
            performedBy: user.id,
          }).catch(console.error);
          return result;
        },
        {
          beforeHandle: checkPermission("update", "Venue"),
          body: "venue.update",
          detail: { tags: ["Venues"], summary: "Update venue" },
        },
      )
      .delete(
        "/:id",
        async ({ params: { id }, user }) => {
          const venue = await venuesService.remove(id);
          createAuditEntry({
            entityType: "venue",
            entityId: id,
            action: "delete",
            newValue: venue,
            performedBy: user.id,
          }).catch(console.error);
          return { message: "Venue deleted", venue };
        },
        {
          beforeHandle: checkPermission("delete", "Venue"),
          detail: { tags: ["Venues"], summary: "Delete venue" },
        },
      ),
  );
