import { sql } from "drizzle-orm";
import { db } from "../db";

export const statsService = {
	async membershipGrowth() {
		const rows = await db.execute<{
			month: string;
			cumulative_members: number;
		}>(sql`
			WITH monthly_first_seen AS (
				SELECT
					from_user_id,
					date_trunc('month', MIN(date)) AS first_month
				FROM telegram_messages
				WHERE chat_type IN ('group', 'supergroup')
					AND from_user_id IS NOT NULL
					AND from_is_bot = false
				GROUP BY from_user_id
			),
			monthly_new AS (
				SELECT first_month AS month, COUNT(*) AS new_members
				FROM monthly_first_seen
				GROUP BY first_month
			),
			date_range AS (
				SELECT MIN(month) AS start_month, date_trunc('month', now()) AS end_month
				FROM monthly_new
			),
			all_months AS (
				SELECT generate_series(start_month, end_month, '1 month'::interval) AS month
				FROM date_range
			),
			filled AS (
				SELECT
					am.month,
					COALESCE(mn.new_members, 0) AS new_members
				FROM all_months am
				LEFT JOIN monthly_new mn ON mn.month = am.month
			)
			SELECT
				to_char(month, 'YYYY-MM') AS month,
				SUM(new_members) OVER (ORDER BY month)::int AS cumulative_members
			FROM filled
			ORDER BY month
		`);

		return rows as unknown as {
			month: string;
			cumulative_members: number;
		}[];
	},
};
