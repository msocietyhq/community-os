import { Elysia } from "elysia";
import { updateMemberSchema } from "@community-os/shared/validators";

export const memberModel = new Elysia({ name: "model.member" }).model({
  "member.update": updateMemberSchema,
});
