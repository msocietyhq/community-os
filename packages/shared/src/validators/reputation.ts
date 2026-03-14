import { z } from "zod";
import { REPUTATION_TRIGGER_TYPES } from "../constants";

export const createReputationEventSchema = z.object({
  from_user_id: z.string(),
  to_user_id: z.string(),
  trigger_id: z.string().uuid(),
  value: z.number().int(),
  telegram_message_id: z.string().optional(),
  telegram_chat_id: z.string().optional(),
});

export const createReputationTriggerSchema = z.object({
  trigger_type: z.enum(REPUTATION_TRIGGER_TYPES),
  trigger_value: z.string().min(1),
  reputation_value: z.number().int(),
  is_active: z.boolean().default(true),
});

export type CreateReputationEventInput = z.infer<typeof createReputationEventSchema>;
export type CreateReputationTriggerInput = z.infer<typeof createReputationTriggerSchema>;
