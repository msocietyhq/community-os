import { desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { datasets } from "../db/schema";

export const datasetRoutes = new Elysia({ prefix: "/api/datasets" })
  .get("/", async () =>
    db.select().from(datasets).orderBy(desc(datasets.updatedAt)),
  )
  .get("/:id", async ({ params: { id }, set }) => {
    const [dataset] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.id, id));
    if (!dataset) {
      set.status = 404;
      return { error: "Dataset not found" };
    }
    return dataset;
  });
