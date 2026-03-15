import { z } from "zod";
import {
  PROJECT_NATURES,
  PROJECT_PLATFORMS,
  PROJECT_STATUSES,
  PROJECT_MEMBER_ROLES,
} from "../constants";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  nature: z.enum(PROJECT_NATURES),
  platforms: z.array(z.enum(PROJECT_PLATFORMS)).default([]),
  url: z.string().url().optional(),
  repoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(PROJECT_STATUSES).optional(),
});

export const addProjectMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(PROJECT_MEMBER_ROLES),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
