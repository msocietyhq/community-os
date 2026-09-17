import { describe, expect, test } from "bun:test";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { botMemories } from "../db/schema/bot";
import {
  CROSS_CATEGORY_DUPLICATE_SIMILARITY,
  DUPLICATE_SIMILARITY,
  duplicateSimilaritySql,
} from "./memory-duplicate-sql";

const embedding = new Array(512).fill(0);

function compiledDuplicateSql() {
  const qb = new QueryBuilder();
  return qb
    .select({ id: botMemories.id })
    .from(botMemories)
    .where(duplicateSimilaritySql(embedding, "person_fact"))
    .toSQL();
}

describe("duplicateSimilaritySql", () => {
  /**
   * Regression for `operator does not exist: double precision > text`.
   *
   * pgvector's cosine score is double precision. Drizzle binds JS numbers as
   * untyped params, and PostgreSQL types a CASE of untyped params as text —
   * so the comparison has no operator unless the branches are cast.
   */
  test("casts CASE thresholds so postgres does not type them as text", () => {
    const { sql: compiled, params } = compiledDuplicateSql();
    expect(compiled).toMatch(/THEN \$(\d+)::float8/);
    expect(compiled).toMatch(/ELSE \$(\d+)::float8/);
    expect(params).toContain(DUPLICATE_SIMILARITY);
    expect(params).toContain(CROSS_CATEGORY_DUPLICATE_SIMILARITY);
  });

  test("runs against postgres without a double precision > text error", async () => {
    const url =
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/community_os";
    const client = postgres(url, { max: 1, connect_timeout: 3 });

    try {
      await client`SET client_min_messages TO WARNING`;
      await client`CREATE EXTENSION IF NOT EXISTS vector`;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (!process.env.DATABASE_URL) {
        console.warn(
          "skipping live postgres check: no DATABASE_URL and local postgres unavailable",
        );
        return;
      }
      throw err;
    }

    const db = drizzle(client);
    try {
      await client`
        CREATE TEMP TABLE bot_memories (
          category text NOT NULL,
          embedding vector(512)
        )
      `;
      await client`
        INSERT INTO bot_memories (category, embedding)
        VALUES ('person_fact', ${`[${embedding.join(",")}]`}::vector)
      `;

      const rows = await db.execute(
        sql`SELECT 1 FROM ${botMemories} WHERE ${duplicateSimilaritySql(
          embedding,
          "person_fact",
        )}`,
      );

      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
