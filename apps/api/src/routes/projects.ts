import { Elysia } from "elysia";
import { z } from "zod";
import { createAuditEntry } from "../middleware/audit";
import { authMiddleware } from "../middleware/auth";
import { checkPermission, checkPermissionOn } from "../middleware/permissions";
import { projectsService } from "../services/projects.service";
import { projectModel } from "./models/project";

const idParams = z.object({ id: z.string().min(1) });
const idUserIdParams = z.object({
	id: z.string().min(1),
	userId: z.string().min(1),
});

/** Build a CASL ownership subject for a project, based on the :id route param. */
async function resolveProjectOwnership(ctx: {
	params: Record<string, string>;
	user: { id: string };
}) {
	const id = ctx.params.id;
	if (!id) return null;
	const ownerIds = await projectsService.getOwnerIds(id);
	const isOwner = ownerIds.includes(ctx.user.id);
	return {
		__caslSubjectType__: "Project" as const,
		ownerId: isOwner ? ctx.user.id : "NOT_OWNER",
	};
}

export const projectRoutes = new Elysia({ prefix: "/api/v1/projects" })
	.use(authMiddleware)
	.use(projectModel)
	.get(
		"/",
		async ({ query }) => {
			return projectsService.list(query);
		},
		{
			query: "project.listQuery",
			detail: { tags: ["Projects"], summary: "List projects" },
		},
	)
	.get(
		"/:id",
		async ({ params: { id } }) => {
			return projectsService.getById(id);
		},
		{
			params: idParams,
			detail: { tags: ["Projects"], summary: "Get project by ID or slug" },
		},
	)
	.guard({ auth: true }, (app) =>
		app
			.post(
				"/",
				async ({ body, user }) => {
					const result = await projectsService.create(body, user.id);
					createAuditEntry({
						entityType: "project",
						entityId: result.id,
						action: "create",
						newValue: result,
						performedBy: user.id,
					}).catch(console.error);
					return result;
				},
				{
					beforeHandle: checkPermission("create", "Project"),
					body: "project.create",
					detail: { tags: ["Projects"], summary: "Create project" },
				},
			)
			.patch(
				"/:id",
				async ({ params: { id }, body, user }) => {
					const result = await projectsService.update(id, body);
					createAuditEntry({
						entityType: "project",
						entityId: id,
						action: "update",
						newValue: result,
						performedBy: user.id,
					}).catch(console.error);
					return result;
				},
				{
					beforeHandle: checkPermissionOn("update", resolveProjectOwnership),
					params: idParams,
					body: "project.update",
					detail: { tags: ["Projects"], summary: "Update project" },
				},
			)
			.delete(
				"/:id",
				async ({ params: { id }, user }) => {
					const result = await projectsService.delete(id);
					createAuditEntry({
						entityType: "project",
						entityId: id,
						action: "delete",
						newValue: result,
						performedBy: user.id,
					}).catch(console.error);
					return { message: "Project deleted", project: result };
				},
				{
					beforeHandle: checkPermissionOn("delete", resolveProjectOwnership),
					params: idParams,
					detail: { tags: ["Projects"], summary: "Delete project" },
				},
			)
			.post(
				"/:id/members",
				async ({ params: { id }, body, user }) => {
					const result = await projectsService.addMember(id, body);
					createAuditEntry({
						entityType: "project",
						entityId: id,
						action: "update",
						newValue: result,
						performedBy: user.id,
					}).catch(console.error);
					return result;
				},
				{
					beforeHandle: checkPermissionOn("update", resolveProjectOwnership),
					params: idParams,
					body: "project.member.add",
					detail: { tags: ["Projects"], summary: "Add project member" },
				},
			)
			.delete(
				"/:id/members/:userId",
				async ({ params: { id, userId }, user }) => {
					const result = await projectsService.removeMember(id, userId);
					createAuditEntry({
						entityType: "project",
						entityId: id,
						action: "delete",
						newValue: { removedUserId: userId },
						performedBy: user.id,
					}).catch(console.error);
					return { message: "Member removed", member: result };
				},
				{
					beforeHandle: checkPermissionOn("update", resolveProjectOwnership),
					params: idUserIdParams,
					detail: { tags: ["Projects"], summary: "Remove project member" },
				},
			)
			.post(
				"/:id/endorse",
				async ({ params: { id }, user }) => {
					const result = await projectsService.endorse(id, user.id);
					createAuditEntry({
						entityType: "project",
						entityId: id,
						action: "update",
						newValue: result,
						performedBy: user.id,
					}).catch(console.error);
					return result;
				},
				{
					beforeHandle: checkPermission("endorse", "Project"),
					params: idParams,
					detail: { tags: ["Projects"], summary: "Endorse project" },
				},
			),
	);
