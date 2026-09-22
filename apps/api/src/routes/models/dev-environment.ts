import {
  ciPreviewEnvironmentSchema,
  createDevEnvironmentSchema,
  createNeonProjectSchema,
  createRailwayProjectSchema,
  createSharedSecretSchema,
  issueAgentKeySchema,
  rotateSharedSecretSchema,
  storeDevEnvironmentVarSchema,
  upsertProjectInfraConfigSchema,
} from "@community-os/shared/validators";
import { Elysia } from "elysia";

export const devEnvironmentModel = new Elysia({
  name: "model.devEnvironment",
}).model({
  "devEnvironment.create": createDevEnvironmentSchema,
  "devEnvironment.var.store": storeDevEnvironmentVarSchema,
  "devEnvironment.agentKey.issue": issueAgentKeySchema,
  "sharedSecret.create": createSharedSecretSchema,
  "sharedSecret.rotate": rotateSharedSecretSchema,
  "projectInfraConfig.upsert": upsertProjectInfraConfigSchema,
  "devEnvironment.ci.ensure": ciPreviewEnvironmentSchema,
  "devEnvironment.ci.teardown": ciPreviewEnvironmentSchema,
  "neonProject.create": createNeonProjectSchema,
  "railwayProject.create": createRailwayProjectSchema,
});
