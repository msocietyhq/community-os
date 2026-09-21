import { z } from "zod";
import { DATASET_CATEGORIES } from "../constants";

export const createDatasetSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  source: z.string().min(1).max(200),
  link: z.string().url(),
  category: z.enum(DATASET_CATEGORIES),
  formats: z.array(z.string()).default([]),
  license: z.string().max(200).optional(),
  coverage: z.string().max(200).optional(),
  lastUpdated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  repoUrl: z.string().url().optional(),
});

export const updateDatasetSchema = createDatasetSchema.partial();

export const datasetListQuerySchema = z.object({
  category: z.enum(DATASET_CATEGORIES).optional(),
});

export type CreateDatasetInput = z.infer<typeof createDatasetSchema>;
export type UpdateDatasetInput = z.infer<typeof updateDatasetSchema>;
export type DatasetListQuery = z.infer<typeof datasetListQuerySchema>;
