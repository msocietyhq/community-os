import { eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { datasets } from "../db/schema/datasets";
import { AppError } from "../lib/errors";
import type {
  CreateDatasetInput,
  UpdateDatasetInput,
  DatasetListQuery,
} from "@community-os/shared/validators";

export const datasetsService = {
  async create(input: CreateDatasetInput, createdBy: string) {
    const [dataset] = await db
      .insert(datasets)
      .values({
        title: input.title,
        description: input.description,
        source: input.source,
        link: input.link,
        category: input.category,
        formats: input.formats,
        license: input.license,
        coverage: input.coverage,
        lastUpdated: input.lastUpdated,
        tags: input.tags,
        repoUrl: input.repoUrl,
        createdBy,
      })
      .returning();

    return dataset;
  },

  async list(query: DatasetListQuery) {
    const where = query.category
      ? and(eq(datasets.category, query.category))
      : undefined;

    return db
      .select()
      .from(datasets)
      .where(where)
      .orderBy(desc(datasets.updatedAt));
  },

  async getById(id: string) {
    const [dataset] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.id, id));

    if (!dataset) {
      throw new AppError(404, "DATASET_NOT_FOUND", "Dataset not found");
    }

    return dataset;
  },

  async update(id: string, input: UpdateDatasetInput) {
    const [existing] = await db
      .select({ id: datasets.id })
      .from(datasets)
      .where(eq(datasets.id, id));

    if (!existing) {
      throw new AppError(404, "DATASET_NOT_FOUND", "Dataset not found");
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.source !== undefined) updateData.source = input.source;
    if (input.link !== undefined) updateData.link = input.link;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.formats !== undefined) updateData.formats = input.formats;
    if (input.license !== undefined) updateData.license = input.license;
    if (input.coverage !== undefined) updateData.coverage = input.coverage;
    if (input.lastUpdated !== undefined)
      updateData.lastUpdated = input.lastUpdated;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.repoUrl !== undefined) updateData.repoUrl = input.repoUrl;

    const [updated] = await db
      .update(datasets)
      .set(updateData)
      .where(eq(datasets.id, id))
      .returning();

    return updated;
  },

  async remove(id: string) {
    const [existing] = await db
      .select({ id: datasets.id })
      .from(datasets)
      .where(eq(datasets.id, id));

    if (!existing) {
      throw new AppError(404, "DATASET_NOT_FOUND", "Dataset not found");
    }

    const [deleted] = await db
      .delete(datasets)
      .where(eq(datasets.id, id))
      .returning();

    return deleted;
  },
};
