import { Elysia } from "elysia";
import {
  createDatasetSchema,
  updateDatasetSchema,
  datasetListQuerySchema,
} from "@community-os/shared/validators";

export const datasetModel = new Elysia({ name: "model.dataset" }).model({
  "dataset.create": createDatasetSchema,
  "dataset.update": updateDatasetSchema,
  "dataset.listQuery": datasetListQuerySchema,
});
