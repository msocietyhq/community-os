import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";
import { datasetModel } from "./models/dataset";
import { datasetsService } from "../services/datasets.service";

export const datasetRoutes = new Elysia({ prefix: "/api/v1/datasets" })
  .use(authMiddleware)
  .use(datasetModel)
  // Public — the dataset directory is a public page, no login required.
  .get(
    "/",
    async ({ query }) => {
      return datasetsService.list(query);
    },
    {
      query: "dataset.listQuery",
      detail: { tags: ["Datasets"], summary: "List datasets" },
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      return datasetsService.getById(id);
    },
    {
      detail: { tags: ["Datasets"], summary: "Get dataset by ID" },
    },
  )
  .guard({ auth: true }, (app) =>
    app
      .post(
        "/",
        async ({ body, user }) => {
          const result = await datasetsService.create(body, user.id);
          if (result) {
            createAuditEntry({
              entityType: "dataset",
              entityId: result.id,
              action: "create",
              newValue: result,
              performedBy: user.id,
            }).catch(console.error);
          }
          return result;
        },
        {
          beforeHandle: checkPermission("create", "Dataset"),
          body: "dataset.create",
          detail: { tags: ["Datasets"], summary: "Create dataset" },
        },
      )
      .patch(
        "/:id",
        async ({ params: { id }, body, user }) => {
          const result = await datasetsService.update(id, body);
          createAuditEntry({
            entityType: "dataset",
            entityId: id,
            action: "update",
            newValue: result,
            performedBy: user.id,
          }).catch(console.error);
          return result;
        },
        {
          beforeHandle: checkPermission("update", "Dataset"),
          body: "dataset.update",
          detail: { tags: ["Datasets"], summary: "Update dataset" },
        },
      )
      .delete(
        "/:id",
        async ({ params: { id }, user }) => {
          const dataset = await datasetsService.remove(id);
          createAuditEntry({
            entityType: "dataset",
            entityId: id,
            action: "delete",
            newValue: dataset,
            performedBy: user.id,
          }).catch(console.error);
          return { message: "Dataset deleted", dataset };
        },
        {
          beforeHandle: checkPermission("delete", "Dataset"),
          detail: { tags: ["Datasets"], summary: "Delete dataset" },
        },
      ),
  );
