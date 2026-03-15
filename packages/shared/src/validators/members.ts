import { z } from "zod";

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
