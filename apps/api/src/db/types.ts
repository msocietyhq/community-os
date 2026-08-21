import { customType } from "drizzle-orm/pg-core";

/**
 * pgvector column type.
 *
 * Shared by `bot_memories`, `telegram_messages` and `members` — one definition
 * so dimension handling and the driver round-trip stay consistent.
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 512})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});
