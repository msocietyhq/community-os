import { Elysia } from "elysia";
import { statsService } from "../services/stats.service";

export const statsRoutes = new Elysia({ prefix: "/api/v1/stats" }).get(
	"/membership-growth",
	async () => {
		return statsService.membershipGrowth();
	},
	{
		detail: {
			tags: ["Stats"],
			summary: "Get cumulative membership growth over time",
		},
	},
);
