import { and, eq, isNotNull, min, sql } from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";

let cache: { points: { month: string; cumulative_members: number }[] } | null =
	null;

export const statsService = {
	async membershipGrowth() {
		if (cache) return cache;
		// Get the first month each user appeared in a group chat
		const rows = await db
			.select({
				firstMonth:
					sql<string>`to_char(${min(telegramMessages.date)}, 'YYYY-MM')`.as(
						"first_month",
					),
				count: sql<number>`count(*)::int`.as("count"),
			})
			.from(telegramMessages)
			.where(
				and(
					sql`${telegramMessages.chatType} IN ('group', 'supergroup')`,
					isNotNull(telegramMessages.fromUserId),
					eq(telegramMessages.fromIsBot, false),
				),
			)
			.groupBy(telegramMessages.fromUserId)
			.then((userRows) => {
				// Count new members per month
				const monthlyCounts = new Map<string, number>();
				for (const row of userRows) {
					const month = row.firstMonth;
					monthlyCounts.set(month, (monthlyCounts.get(month) ?? 0) + 1);
				}
				return monthlyCounts;
			});

		// Build continuous timeseries with cumulative sum
		const months = [...rows.keys()].sort();
		if (months.length === 0) return { points: [] };

		const start = new Date(`${months[0]}-01`);
		const end = new Date();
		end.setDate(1);

		const points: { month: string; cumulative_members: number }[] = [];
		let cumulative = 0;
		const cursor = new Date(start);

		while (cursor <= end) {
			const key = cursor.toISOString().slice(0, 7);
			cumulative += rows.get(key) ?? 0;
			points.push({ month: key, cumulative_members: cumulative });
			cursor.setMonth(cursor.getMonth() + 1);
		}

		cache = { points };
		return cache;
	},
};
