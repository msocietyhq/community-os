import type {
	AddProjectMemberInput,
	CreateProjectInput,
	ProjectListQuery,
	UpdateProjectInput,
} from "@community-os/shared/validators";
import { and, count, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { projectMembers, projects } from "../db/schema";
import { user } from "../db/schema/auth";
import { AppError } from "../lib/errors";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function resolveProjectId(idOrSlug: string): Promise<string> {
	const condition = UUID_RE.test(idOrSlug)
		? eq(projects.id, idOrSlug)
		: eq(projects.slug, idOrSlug);

	const [row] = await db
		.select({ id: projects.id })
		.from(projects)
		.where(and(condition, isNull(projects.deletedAt)));

	if (!row) {
		throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
	}
	return row.id;
}

export const projectsService = {
	async create(input: CreateProjectInput, createdBy: string) {
		const slug = generateSlug(input.name);

		const [project] = await db
			.insert(projects)
			.values({
				name: input.name,
				slug,
				description: input.description,
				nature: input.nature,
				platforms: input.platforms,
				url: input.url,
				repoUrl: input.repoUrl,
				thumbnailUrl: input.thumbnailUrl,
			})
			.returning();

		if (!project) {
			throw new AppError(500, "CREATE_FAILED", "Failed to create project");
		}

		await db.insert(projectMembers).values({
			projectId: project.id,
			userId: createdBy,
			role: "owner",
		});

		return project;
	},

	async list(query: ProjectListQuery) {
		const conditions = [isNull(projects.deletedAt)];

		if (query.status) {
			conditions.push(eq(projects.status, query.status));
		}
		if (query.nature) {
			conditions.push(eq(projects.nature, query.nature));
		}
		if (query.search) {
			const pattern = `%${query.search}%`;
			conditions.push(
				sql`(${ilike(projects.name, pattern)} OR ${ilike(projects.description, pattern)})`,
			);
		}

		const where = and(...conditions);
		const offset = (query.page - 1) * query.limit;

		const memberCountSq = db
			.select({
				projectId: projectMembers.projectId,
				memberCount: count().as("member_count"),
			})
			.from(projectMembers)
			.groupBy(projectMembers.projectId)
			.as("member_counts");

		const [projectList, totalResult] = await Promise.all([
			db
				.select({
					project: projects,
					memberCount:
						sql<number>`coalesce(${memberCountSq.memberCount}, 0)`.mapWith(
							Number,
						),
				})
				.from(projects)
				.leftJoin(memberCountSq, eq(projects.id, memberCountSq.projectId))
				.where(where)
				.orderBy(desc(projects.createdAt))
				.limit(query.limit)
				.offset(offset),
			db.select({ total: count() }).from(projects).where(where),
		]);

		const projectIds = projectList.map((r) => r.project.id);

		const memberPreviews =
			projectIds.length > 0
				? await db
						.select({
							projectId: projectMembers.projectId,
							userId: user.id,
							name: user.name,
							image: user.image,
						})
						.from(projectMembers)
						.innerJoin(user, eq(projectMembers.userId, user.id))
						.where(
							sql`${projectMembers.projectId} IN ${projectIds}`,
						)
						.orderBy(projectMembers.createdAt)
				: [];

		const membersByProject = new Map<
			string,
			{ id: string; name: string; image: string | null }[]
		>();
		for (const m of memberPreviews) {
			const list = membersByProject.get(m.projectId) ?? [];
			list.push({ id: m.userId, name: m.name, image: m.image });
			membersByProject.set(m.projectId, list);
		}

		return {
			projects: projectList.map((r) => ({
				...r.project,
				memberCount: r.memberCount,
				members: (membersByProject.get(r.project.id) ?? []).slice(0, 3),
			})),
			total: totalResult[0]?.total ?? 0,
		};
	},

	async getById(idOrSlug: string) {
		const condition = UUID_RE.test(idOrSlug)
			? eq(projects.id, idOrSlug)
			: eq(projects.slug, idOrSlug);

		const [project] = await db
			.select()
			.from(projects)
			.where(and(condition, isNull(projects.deletedAt)));

		if (!project) {
			throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
		}

		const members = await db
			.select({
				id: user.id,
				name: user.name,
				image: user.image,
				role: projectMembers.role,
			})
			.from(projectMembers)
			.innerJoin(user, eq(projectMembers.userId, user.id))
			.where(eq(projectMembers.projectId, project.id));

		return { ...project, members };
	},

	async update(idOrSlug: string, input: UpdateProjectInput) {
		const id = await resolveProjectId(idOrSlug);

		const updateData: Record<string, unknown> = { updatedAt: new Date() };

		if (input.name !== undefined) updateData.name = input.name;
		if (input.description !== undefined)
			updateData.description = input.description;
		if (input.nature !== undefined) updateData.nature = input.nature;
		if (input.platforms !== undefined) updateData.platforms = input.platforms;
		if (input.status !== undefined) updateData.status = input.status;
		if (input.url !== undefined) updateData.url = input.url;
		if (input.repoUrl !== undefined) updateData.repoUrl = input.repoUrl;
		if (input.thumbnailUrl !== undefined)
			updateData.thumbnailUrl = input.thumbnailUrl;

		const [updated] = await db
			.update(projects)
			.set(updateData)
			.where(eq(projects.id, id))
			.returning();

		return updated;
	},

	async delete(idOrSlug: string) {
		const id = await resolveProjectId(idOrSlug);

		const [deleted] = await db
			.update(projects)
			.set({
				deletedAt: new Date(),
				status: "archived",
				updatedAt: new Date(),
			})
			.where(eq(projects.id, id))
			.returning();

		return deleted;
	},

	async addMember(idOrSlug: string, input: AddProjectMemberInput) {
		const id = await resolveProjectId(idOrSlug);

		const [member] = await db
			.insert(projectMembers)
			.values({
				projectId: id,
				userId: input.userId,
				role: input.role,
			})
			.onConflictDoUpdate({
				target: [projectMembers.projectId, projectMembers.userId],
				set: {
					role: input.role,
					updatedAt: new Date(),
				},
			})
			.returning();

		return member;
	},

	async removeMember(idOrSlug: string, userId: string) {
		const id = await resolveProjectId(idOrSlug);

		const owners = await db
			.select({ userId: projectMembers.userId })
			.from(projectMembers)
			.where(
				and(eq(projectMembers.projectId, id), eq(projectMembers.role, "owner")),
			);

		const isOwner = owners.some((o) => o.userId === userId);
		if (isOwner && owners.length <= 1) {
			throw new AppError(
				400,
				"LAST_OWNER",
				"Cannot remove the last owner of a project",
			);
		}

		const [removed] = await db
			.delete(projectMembers)
			.where(
				and(
					eq(projectMembers.projectId, id),
					eq(projectMembers.userId, userId),
				),
			)
			.returning();

		if (!removed) {
			throw new AppError(404, "MEMBER_NOT_FOUND", "Project member not found");
		}

		return removed;
	},

	async endorse(idOrSlug: string, endorsedBy: string) {
		const id = await resolveProjectId(idOrSlug);

		const [updated] = await db
			.update(projects)
			.set({
				isEndorsed: true,
				endorsedAt: new Date(),
				endorsedBy,
				updatedAt: new Date(),
			})
			.where(eq(projects.id, id))
			.returning();

		return updated;
	},

	async getOwnerIds(projectIdOrSlug: string): Promise<string[]> {
		const id = UUID_RE.test(projectIdOrSlug)
			? projectIdOrSlug
			: await resolveProjectId(projectIdOrSlug);

		const owners = await db
			.select({ userId: projectMembers.userId })
			.from(projectMembers)
			.where(
				and(eq(projectMembers.projectId, id), eq(projectMembers.role, "owner")),
			);

		return owners.map((o) => o.userId);
	},
};
