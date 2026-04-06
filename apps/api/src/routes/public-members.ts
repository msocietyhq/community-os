import { Elysia } from "elysia";
import { membersService } from "../services/members.service";

export const publicMemberRoutes = new Elysia({
	prefix: "/api/v1/members",
}).get(
	"/username/:username",
	async ({ params: { username }, set }) => {
		const member = await membersService.findByUsername(username);
		if (!member) {
			set.status = 404;
			return { message: "Member not found" };
		}
		return member;
	},
	{
		detail: {
			tags: ["Members"],
			summary: "Get public member profile by Telegram username",
		},
	},
);
