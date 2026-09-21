import { z } from "zod";
import {
  FUND_CAUSE_STATUSES,
  FUND_TRANSACTION_REFERENCE_TYPES,
  FUND_TRANSACTION_TYPES,
} from "../constants";
import { paginationSchema } from "./common";

const baseTransactionSchema = z.object({
  type: z.enum(FUND_TRANSACTION_TYPES),
  amount: z.number().refine((v) => v !== 0, "amount must not be zero"),
  currency: z.string().default("SGD"),
  description: z.string().min(1),
  categoryId: z.string().uuid(),
  referenceType: z.enum(FUND_TRANSACTION_REFERENCE_TYPES).optional(),
  referenceId: z.string().uuid().optional(),
  pledgeId: z.string().uuid().optional(),
  paidBy: z.string().optional(),
  receivedBy: z.string().optional(),
  receiptUrl: z.string().url().optional(),
  occurredAt: z.string().datetime(),
});

export const createTransactionSchema = baseTransactionSchema.refine(
  // Every type except "adjustment" records a fixed-direction flow (a
  // pledge collected, money spent) and is always stored positive; the
  // service derives its sign for balance math from `type` alone.
  // "adjustment" is the one row where the bookkeeper is correcting a
  // balance either way, so its sign IS the direction and both are valid.
  (data) => data.type === "adjustment" || data.amount > 0,
  {
    message: "amount must be positive for this transaction type",
    path: ["amount"],
  },
);

export const updateTransactionSchema = baseTransactionSchema.partial();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const fundTransactionListQuerySchema = paginationSchema.extend({
  type: z.enum(FUND_TRANSACTION_TYPES).optional(),
  categoryId: z.string().uuid().optional(),
  referenceType: z.enum(FUND_TRANSACTION_REFERENCE_TYPES).optional(),
  referenceId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type FundTransactionListQuery = z.infer<
  typeof fundTransactionListQuerySchema
>;

export const FUND_REPORT_GROUP_BY = [
  "day",
  "week",
  "month",
  "category",
  "type",
  "cause",
] as const;
export type FundReportGroupBy = (typeof FUND_REPORT_GROUP_BY)[number];

export const fundReportQuerySchema = z.object({
  groupBy: z.enum(FUND_REPORT_GROUP_BY).default("month"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  type: z.enum(FUND_TRANSACTION_TYPES).optional(),
  categoryId: z.string().uuid().optional(),
  referenceType: z.enum(FUND_TRANSACTION_REFERENCE_TYPES).optional(),
  referenceId: z.string().uuid().optional(),
});
export type FundReportQuery = z.infer<typeof fundReportQuerySchema>;

export const createFundCauseSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  targetAmount: z.number().positive().optional(),
});
export const updateFundCauseSchema = createFundCauseSchema.partial().extend({
  status: z.enum(FUND_CAUSE_STATUSES).optional(),
});
export type CreateFundCauseInput = z.infer<typeof createFundCauseSchema>;
export type UpdateFundCauseInput = z.infer<typeof updateFundCauseSchema>;

export const fundCauseListQuerySchema = paginationSchema.extend({
  status: z.enum(FUND_CAUSE_STATUSES).optional(),
});
export type FundCauseListQuery = z.infer<typeof fundCauseListQuerySchema>;
