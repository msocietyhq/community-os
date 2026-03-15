import { Elysia } from "elysia";
import { createReputationEventSchema } from "@community-os/shared/validators";

export const reputationModel = new Elysia({ name: "model.reputation" }).model({
  "reputation.event.create": createReputationEventSchema,
});
