import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";
import { fundModel } from "./models/fund";

export const fundRoutes = new Elysia({ prefix: "/api/v1/funds" })
  .use(authMiddleware)
  .use(fundModel)
  .get(
    "/overview",
    async () => {
      // TODO: Implement fund overview
      return { totalExpenses: 0, totalReimbursements: 0, balance: 0 };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      detail: { tags: ["Funds"], summary: "Get fund overview" },
    }
  )
  .get(
    "/balances",
    async () => {
      // TODO: Implement member balances
      return { balances: [] };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      detail: { tags: ["Funds"], summary: "Get member balances" },
    }
  )
  .get(
    "/transactions",
    async () => {
      // TODO: Implement transaction listing
      return { transactions: [], total: 0 };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Fund"),
      detail: { tags: ["Funds"], summary: "List transactions" },
    }
  )
  .post(
    "/transactions",
    async ({ body, user }) => {
      // TODO: Implement create transaction
      return { message: "Transaction created" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("create", "Fund"),
      body: "fund.transaction.create",
      detail: { tags: ["Funds"], summary: "Create transaction" },
    }
  );
