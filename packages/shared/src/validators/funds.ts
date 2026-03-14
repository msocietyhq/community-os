import { z } from "zod";
import { FUND_TRANSACTION_TYPES } from "../constants";

export const createTransactionSchema = z.object({
  type: z.enum(FUND_TRANSACTION_TYPES),
  amount: z.number().positive(),
  currency: z.string().default("SGD"),
  description: z.string().min(1),
  category_id: z.string().uuid(),
  reference_type: z.enum(["event", "project", "provisioned_resource"]).optional(),
  reference_id: z.string().uuid().optional(),
  pledge_id: z.string().uuid().optional(),
  paid_by: z.string().optional(),
  received_by: z.string().optional(),
  receipt_url: z.string().url().optional(),
  occurred_at: z.string().datetime(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
