import { z } from "zod";
import { REPUTATION_TRIGGER_TYPES } from "../constants";

export const createReputationEventSchema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  triggerId: z.string().uuid(),
  value: z.number().int(),
  telegramMessageId: z.string().optional(),
  telegramChatId: z.string().optional(),
});

export const createReputationTriggerSchema = z.object({
  triggerType: z.enum(REPUTATION_TRIGGER_TYPES),
  triggerValue: z.string().min(1),
  reputationValue: z.number().int(),
  isActive: z.boolean().default(true),
});

export type CreateReputationEventInput = z.infer<typeof createReputationEventSchema>;
export type CreateReputationTriggerInput = z.infer<typeof createReputationTriggerSchema>;
