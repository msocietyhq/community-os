import { Elysia } from "elysia";
import { createTransactionSchema } from "@community-os/shared/validators";

export const fundModel = new Elysia({ name: "model.fund" }).model({
  "fund.transaction.create": createTransactionSchema,
});
