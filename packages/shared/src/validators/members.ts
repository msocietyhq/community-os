import { z } from "zod";

export const updateMemberSchema = z.object({
  telegram_username: z.string().optional(),
  github_handle: z.string().optional(),
  phone_number: z.string().optional(),
  bio: z.string().max(500).optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  current_company: z.string().optional(),
  current_title: z.string().optional(),
  education: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  website_url: z.string().url().optional(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
