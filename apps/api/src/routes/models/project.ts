import {
	addProjectMemberSchema,
	createProjectSchema,
	projectListQuerySchema,
	updateProjectSchema,
} from "@community-os/shared/validators";
import { Elysia } from "elysia";

export const projectModel = new Elysia({ name: "model.project" }).model({
	"project.create": createProjectSchema,
	"project.update": updateProjectSchema,
	"project.member.add": addProjectMemberSchema,
	"project.listQuery": projectListQuerySchema,
});
