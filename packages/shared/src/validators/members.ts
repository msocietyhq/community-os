import { z } from "zod";
import { paginationSchema } from "./common";

export const memberListQuerySchema = paginationSchema.extend({
  q: z.string().optional(),
  role: z.string().optional(),
  skills: z.string().optional(),
  interests: z.string().optional(),
});

export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

export const createMemberSchema = z.object({
  bio: z.string().max(500).optional(),
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  githubHandle: z.string().optional(),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  githubHandle: z.string().optional(),
  phoneNumber: z.string().optional(),
  bio: z.string().max(500).optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  currentCompany: z.string().optional(),
  currentTitle: z.string().optional(),
  education: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
