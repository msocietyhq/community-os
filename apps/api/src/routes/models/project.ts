import { Elysia } from "elysia";
import {
  createProjectSchema,
  addProjectMemberSchema,
} from "@community-os/shared/validators";

export const projectModel = new Elysia({ name: "model.project" }).model({
  "project.create": createProjectSchema,
  "project.member.add": addProjectMemberSchema,
});
