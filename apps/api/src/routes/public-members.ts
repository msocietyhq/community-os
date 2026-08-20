import { Elysia } from "elysia";
import { membersService } from "../services/members.service";
import { generateMemberOgImage } from "../services/og.service";
import { getPhoto } from "../services/photos.service";

export const publicMemberRoutes = new Elysia({
	prefix: "/api/v1/members",
})
	.get(
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
	)
	.get(
		"/:userId/photo",
		async ({ params: { userId }, set }) => {
			const photo = await getPhoto(userId);
			if (!photo) {
				set.status = 404;
				return { message: "Photo not found" };
			}
			// Fresh ArrayBuffer-backed view to satisfy strict BodyInit typing.
			const body = new Uint8Array(photo.data.byteLength);
			body.set(photo.data);
			return new Response(body, {
				headers: {
					"Content-Type": photo.contentType,
					"Cache-Control":
						"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					"Last-Modified": photo.updatedAt.toUTCString(),
				},
			});
		},
		{
			detail: {
				tags: ["Members"],
				summary: "Get a member's profile photo",
			},
		},
	)
	.get(
		"/username/:username/og-image",
		async ({ params: { username }, set }) => {
			const member = await membersService.findByUsername(username);
			if (!member) {
				set.status = 404;
				return { message: "Member not found" };
			}
			const png = await generateMemberOgImage({
				user: {
					name: member.user.name,
					image: member.user.image,
					telegramUsername: member.user.telegramUsername,
				},
				bio: member.bio,
				currentTitle: member.currentTitle,
				currentCompany: member.currentCompany,
				skills: member.skills,
				joinedAt: member.joinedAt,
				projectCount: member.projects.length,
			});
			// Copy into a fresh ArrayBuffer-backed Uint8Array to satisfy strict BodyInit typing.
			const body = new Uint8Array(png.byteLength);
			body.set(png);
			return new Response(body, {
				headers: {
					"Content-Type": "image/png",
					"Cache-Control":
						"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
				},
			});
		},
		{
			detail: {
				tags: ["Members"],
				summary:
					"Generate OG image for a member profile (PNG, 1200x630)",
			},
		},
	);
