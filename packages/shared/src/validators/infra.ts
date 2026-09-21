import { z } from "zod";

export const storeResourceSecretSchema = z.object({
  value: z.string().min(1).max(8192),
});

export type StoreResourceSecretInput = z.infer<
  typeof storeResourceSecretSchema
>;
