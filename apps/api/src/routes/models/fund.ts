import {
  createFundCauseSchema,
  createTransactionSchema,
  fundCauseListQuerySchema,
  fundReportQuerySchema,
  fundTransactionListQuerySchema,
  updateFundCauseSchema,
} from "@community-os/shared/validators";
import { Elysia } from "elysia";

export const fundModel = new Elysia({ name: "model.fund" }).model({
  "fund.transaction.create": createTransactionSchema,
  "fund.transaction.listQuery": fundTransactionListQuerySchema,
  "fund.report.query": fundReportQuerySchema,
  "fund.cause.create": createFundCauseSchema,
  "fund.cause.update": updateFundCauseSchema,
  "fund.cause.listQuery": fundCauseListQuerySchema,
});
