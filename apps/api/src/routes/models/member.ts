import { Elysia } from "elysia";
import {
  updateMemberSchema,
  memberListQuerySchema,
  banMemberSchema,
  changeRoleSchema,
  dismissSuggestionsSchema,
} from "@community-os/shared/validators";

export const memberModel = new Elysia({ name: "model.member" }).model({
  "member.update": updateMemberSchema,
  "member.listQuery": memberListQuerySchema,
  "member.ban": banMemberSchema,
  "member.changeRole": changeRoleSchema,
  "member.dismissSuggestions": dismissSuggestionsSchema,
});
