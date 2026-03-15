import { z } from "zod";
import { FUND_TRANSACTION_TYPES } from "../constants";

export const createTransactionSchema = z.object({
  type: z.enum(FUND_TRANSACTION_TYPES),
  amount: z.number().positive(),
  currency: z.string().default("SGD"),
  description: z.string().min(1),
  categoryId: z.string().uuid(),
  referenceType: z.enum(["event", "project", "provisioned_resource"]).optional(),
  referenceId: z.string().uuid().optional(),
  pledgeId: z.string().uuid().optional(),
  paidBy: z.string().optional(),
  receivedBy: z.string().optional(),
  receiptUrl: z.string().url().optional(),
  occurredAt: z.string().datetime(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
