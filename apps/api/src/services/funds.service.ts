import type {
  CreateFundCauseInput,
  CreateTransactionInput,
  FundCauseListQuery,
  FundReportQuery,
  FundTransactionListQuery,
  UpdateFundCauseInput,
} from "@community-os/shared/validators";
import type {
  FundTransactionReferenceType,
  FundTransactionType,
} from "@community-os/shared/constants";
import { and, count, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { fundCauses, fundTransactions, spendCategories } from "../db/schema";
import { AppError } from "../lib/errors";
import { listOffset, paginatedResult } from "../lib/pagination";

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

interface TransactionFilters {
  type?: FundTransactionType;
  categoryId?: string;
  referenceType?: FundTransactionReferenceType;
  referenceId?: string;
  from?: string;
  to?: string;
}

function transactionFilters(query: TransactionFilters) {
  const conditions = [];
  if (query.type) conditions.push(eq(fundTransactions.type, query.type));
  if (query.categoryId)
    conditions.push(eq(fundTransactions.categoryId, query.categoryId));
  if (query.referenceType)
    conditions.push(eq(fundTransactions.referenceType, query.referenceType));
  if (query.referenceId)
    conditions.push(eq(fundTransactions.referenceId, query.referenceId));
  if (query.from)
    conditions.push(gte(fundTransactions.occurredAt, new Date(query.from)));
  if (query.to)
    conditions.push(lte(fundTransactions.occurredAt, new Date(query.to)));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * expense/reimbursement are stored positive and always an outflow;
 * pledge_collection is stored positive and always an inflow; adjustment is
 * stored with its sign carrying the direction (see createTransactionSchema).
 */
function incomeSql() {
  return sql<string>`COALESCE(SUM(CASE
    WHEN ${fundTransactions.type} = 'pledge_collection' THEN ${fundTransactions.amount}::numeric
    WHEN ${fundTransactions.type} = 'adjustment' AND ${fundTransactions.amount}::numeric > 0 THEN ${fundTransactions.amount}::numeric
    ELSE 0
  END), 0)`;
}

function expenseSql() {
  return sql<string>`COALESCE(SUM(CASE
    WHEN ${fundTransactions.type} IN ('expense', 'reimbursement') THEN ${fundTransactions.amount}::numeric
    WHEN ${fundTransactions.type} = 'adjustment' AND ${fundTransactions.amount}::numeric < 0 THEN ABS(${fundTransactions.amount}::numeric)
    ELSE 0
  END), 0)`;
}

export interface Bucket {
  bucket: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export const fundsService = {
  async createTransaction(input: CreateTransactionInput, recordedBy: string) {
    const [row] = await db
      .insert(fundTransactions)
      .values({
        type: input.type,
        amount: input.amount.toString(),
        currency: input.currency,
        description: input.description,
        categoryId: input.categoryId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        pledgeId: input.pledgeId,
        paidBy: input.paidBy,
        receivedBy: input.receivedBy,
        recordedBy,
        receiptUrl: input.receiptUrl,
        occurredAt: new Date(input.occurredAt),
      })
      .returning();

    if (!row) {
      throw new AppError(500, "CREATE_FAILED", "Failed to create transaction");
    }

    return row;
  },

  async listTransactions(query: FundTransactionListQuery) {
    const offset = listOffset(query.page, query.limit);
    const where = transactionFilters(query);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(fundTransactions)
        .where(where)
        .orderBy(desc(fundTransactions.occurredAt))
        .limit(query.limit)
        .offset(offset),
      db.select({ total: count() }).from(fundTransactions).where(where),
    ]);

    return paginatedResult(
      "transactions",
      rows,
      query.page,
      query.limit,
      totalRow?.total ?? 0,
    );
  },

  async overview() {
    const [row] = await db
      .select({ income: incomeSql(), expense: expenseSql() })
      .from(fundTransactions);

    const totalIncome = Number(row?.income ?? 0);
    const totalExpenses = Number(row?.expense ?? 0);

    return {
      totalIncome,
      totalExpenses,
      balance: totalIncome - totalExpenses,
    };
  },

  /** Per-member totals: what they've paid into the fund vs. been reimbursed. */
  async balances() {
    const [contributedRows, reimbursedRows] = await Promise.all([
      db
        .select({
          userId: fundTransactions.paidBy,
          total: sql<string>`COALESCE(SUM(${fundTransactions.amount}::numeric), 0)`,
        })
        .from(fundTransactions)
        .where(
          and(
            eq(fundTransactions.type, "pledge_collection"),
            isNotNull(fundTransactions.paidBy),
          ),
        )
        .groupBy(fundTransactions.paidBy),
      db
        .select({
          userId: fundTransactions.receivedBy,
          total: sql<string>`COALESCE(SUM(${fundTransactions.amount}::numeric), 0)`,
        })
        .from(fundTransactions)
        .where(
          and(
            eq(fundTransactions.type, "reimbursement"),
            isNotNull(fundTransactions.receivedBy),
          ),
        )
        .groupBy(fundTransactions.receivedBy),
    ]);

    const balances = new Map<
      string,
      { userId: string; contributed: number; reimbursed: number }
    >();

    for (const row of contributedRows) {
      if (!row.userId) continue;
      balances.set(row.userId, {
        userId: row.userId,
        contributed: Number(row.total),
        reimbursed: 0,
      });
    }
    for (const row of reimbursedRows) {
      if (!row.userId) continue;
      const existing = balances.get(row.userId) ?? {
        userId: row.userId,
        contributed: 0,
        reimbursed: 0,
      };
      existing.reimbursed = Number(row.total);
      balances.set(row.userId, existing);
    }

    return Array.from(balances.values());
  },

  /** Flexible aggregation over transactions — by time bucket, category, type, or cause. */
  async report(query: FundReportQuery) {
    const where = transactionFilters(query);

    const [totalsRow] = await db
      .select({ income: incomeSql(), expense: expenseSql(), count: count() })
      .from(fundTransactions)
      .where(where);

    const totalIncome = Number(totalsRow?.income ?? 0);
    const totalExpense = Number(totalsRow?.expense ?? 0);

    let buckets: Bucket[];

    switch (query.groupBy) {
      case "day":
      case "week":
      case "month": {
        const dateFormat = query.groupBy === "month" ? "YYYY-MM" : "YYYY-MM-DD";
        const bucketExpr = sql<string>`to_char(date_trunc(${query.groupBy}, ${fundTransactions.occurredAt}), ${dateFormat})`;
        const rows = await db
          .select({
            bucket: bucketExpr,
            income: incomeSql(),
            expense: expenseSql(),
            count: count(),
          })
          .from(fundTransactions)
          .where(where)
          .groupBy(bucketExpr)
          .orderBy(bucketExpr);
        buckets = rows.map((r) =>
          toBucket(r.bucket, r.income, r.expense, r.count),
        );
        break;
      }
      case "type": {
        const rows = await db
          .select({
            bucket: fundTransactions.type,
            income: incomeSql(),
            expense: expenseSql(),
            count: count(),
          })
          .from(fundTransactions)
          .where(where)
          .groupBy(fundTransactions.type)
          .orderBy(fundTransactions.type);
        buckets = rows.map((r) =>
          toBucket(r.bucket, r.income, r.expense, r.count),
        );
        break;
      }
      case "category": {
        const rows = await db
          .select({
            bucket: spendCategories.displayName,
            income: incomeSql(),
            expense: expenseSql(),
            count: count(),
          })
          .from(fundTransactions)
          .leftJoin(
            spendCategories,
            eq(fundTransactions.categoryId, spendCategories.id),
          )
          .where(where)
          .groupBy(spendCategories.displayName)
          .orderBy(spendCategories.displayName);
        buckets = rows.map((r) =>
          toBucket(r.bucket ?? "Uncategorized", r.income, r.expense, r.count),
        );
        break;
      }
      case "cause": {
        const rows = await db
          .select({
            bucket: fundCauses.name,
            income: incomeSql(),
            expense: expenseSql(),
            count: count(),
          })
          .from(fundTransactions)
          .leftJoin(fundCauses, eq(fundTransactions.referenceId, fundCauses.id))
          .where(and(where, eq(fundTransactions.referenceType, "cause")))
          .groupBy(fundCauses.name)
          .orderBy(fundCauses.name);
        buckets = rows.map((r) =>
          toBucket(r.bucket ?? "Unknown cause", r.income, r.expense, r.count),
        );
        break;
      }
    }

    return {
      groupBy: query.groupBy,
      from: query.from ?? null,
      to: query.to ?? null,
      totals: {
        income: totalIncome,
        expense: totalExpense,
        net: totalIncome - totalExpense,
        count: totalsRow?.count ?? 0,
      },
      buckets,
    };
  },

  async createCause(input: CreateFundCauseInput, createdBy: string) {
    const [row] = await db
      .insert(fundCauses)
      .values({
        name: input.name,
        slug: generateSlug(input.name),
        description: input.description,
        targetAmount: input.targetAmount?.toString(),
        createdBy,
      })
      .returning();

    if (!row) {
      throw new AppError(500, "CREATE_FAILED", "Failed to create fund cause");
    }

    return row;
  },

  async listCauses(query: FundCauseListQuery) {
    const offset = listOffset(query.page, query.limit);
    const where = query.status
      ? eq(fundCauses.status, query.status)
      : undefined;

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(fundCauses)
        .where(where)
        .orderBy(desc(fundCauses.createdAt))
        .limit(query.limit)
        .offset(offset),
      db.select({ total: count() }).from(fundCauses).where(where),
    ]);

    return paginatedResult(
      "causes",
      rows,
      query.page,
      query.limit,
      totalRow?.total ?? 0,
    );
  },

  async getCauseById(id: string) {
    const [cause] = await db
      .select()
      .from(fundCauses)
      .where(eq(fundCauses.id, id));

    if (!cause) {
      throw new AppError(404, "CAUSE_NOT_FOUND", "Fund cause not found");
    }

    const [raised] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${fundTransactions.amount}::numeric), 0)`,
      })
      .from(fundTransactions)
      .where(
        and(
          eq(fundTransactions.referenceType, "cause"),
          eq(fundTransactions.referenceId, id),
          eq(fundTransactions.type, "pledge_collection"),
        ),
      );

    return { ...cause, raisedAmount: Number(raised?.total ?? 0) };
  },

  async updateCause(id: string, input: UpdateFundCauseInput) {
    const [row] = await db
      .update(fundCauses)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.targetAmount !== undefined && {
          targetAmount: input.targetAmount.toString(),
        }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      })
      .where(eq(fundCauses.id, id))
      .returning();

    if (!row) {
      throw new AppError(404, "CAUSE_NOT_FOUND", "Fund cause not found");
    }

    return row;
  },
};

function toBucket(
  bucket: string,
  income: string,
  expense: string,
  count: number,
): Bucket {
  const incomeNum = Number(income);
  const expenseNum = Number(expense);
  return {
    bucket,
    income: incomeNum,
    expense: expenseNum,
    net: incomeNum - expenseNum,
    count,
  };
}
