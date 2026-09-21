import { Elysia } from "elysia";
import { z } from "zod";
import { createAuditEntry } from "../middleware/audit";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { fundsService } from "../services/funds.service";
import { fundModel } from "./models/fund";

const idParams = z.object({ id: z.string().min(1) });

export const fundRoutes = new Elysia({ prefix: "/api/v1/funds" })
  .use(authMiddleware)
  .use(fundModel)
  .get(
    "/overview",
    async () => {
      return fundsService.overview();
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      detail: { tags: ["Funds"], summary: "Get fund overview" },
    },
  )
  .get(
    "/balances",
    async () => {
      const balances = await fundsService.balances();
      return { balances };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      detail: { tags: ["Funds"], summary: "Get member balances" },
    },
  )
  .get(
    "/reports",
    async ({ query }) => {
      return fundsService.report(query);
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      query: "fund.report.query",
      detail: {
        tags: ["Funds"],
        summary:
          "Flexible transaction report (group by day/week/month/category/type/cause)",
      },
    },
  )
  .get(
    "/transactions",
    async ({ query }) => {
      return fundsService.listTransactions(query);
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      query: "fund.transaction.listQuery",
      detail: { tags: ["Funds"], summary: "List transactions" },
    },
  )
  .post(
    "/transactions",
    async ({ body, user }) => {
      const result = await fundsService.createTransaction(body, user.id);
      createAuditEntry({
        entityType: "fund",
        entityId: result.id,
        action: "create",
        newValue: result,
        performedBy: user.id,
      }).catch(console.error);
      return result;
    },
    {
      auth: true,
      beforeHandle: checkPermission("create", "Fund"),
      body: "fund.transaction.create",
      detail: { tags: ["Funds"], summary: "Create transaction" },
    },
  )
  .get(
    "/causes",
    async ({ query }) => {
      return fundsService.listCauses(query);
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      query: "fund.cause.listQuery",
      detail: {
        tags: ["Funds"],
        summary:
          "List fundraising causes (raised totals derived from transactions)",
      },
    },
  )
  .get(
    "/causes/:id",
    async ({ params: { id } }) => {
      return fundsService.getCauseById(id);
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      params: idParams,
      detail: { tags: ["Funds"], summary: "Get a fundraising cause" },
    },
  )
  .post(
    "/causes",
    async ({ body, user }) => {
      const result = await fundsService.createCause(body, user.id);
      createAuditEntry({
        entityType: "fund",
        entityId: result.id,
        action: "create",
        newValue: result,
        performedBy: user.id,
      }).catch(console.error);
      return result;
    },
    {
      auth: true,
      beforeHandle: checkPermission("create", "Fund"),
      body: "fund.cause.create",
      detail: { tags: ["Funds"], summary: "Create a fundraising cause" },
    },
  )
  .patch(
    "/causes/:id",
    async ({ params: { id }, body, user }) => {
      const result = await fundsService.updateCause(id, body);
      createAuditEntry({
        entityType: "fund",
        entityId: id,
        action: "update",
        newValue: result,
        performedBy: user.id,
      }).catch(console.error);
      return result;
    },
    {
      auth: true,
      beforeHandle: checkPermission("update", "Fund"),
      params: idParams,
      body: "fund.cause.update",
      detail: { tags: ["Funds"], summary: "Update a fundraising cause" },
    },
  );
