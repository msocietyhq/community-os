import { Cron } from "croner";
import { isNotNull } from "drizzle-orm";
import { db } from "../db";
import { projectInfraConfigs } from "../db/schema";
import { usageService } from "./usage.service";

let usageCollectionCron: Cron | null = null;

const SGT = { timezone: "Asia/Singapore" } as const;

/**
 * Daily pull of Neon consumption metrics for every project that has a Neon
 * project linked (issue #52 follow-up / ADR-010). One project's failure
 * (e.g. not on a usage-based Neon plan) never blocks the rest — each is its
 * own try/catch, same as `collectNeonUsageForProject`'s own graceful
 * handling of a 4xx from Neon.
 */
export function startUsageScheduler(): void {
  if (usageCollectionCron) return;

  usageCollectionCron = new Cron("0 3 * * *", SGT, async () => {
    const linkedProjects = await db
      .select({ projectId: projectInfraConfigs.projectId })
      .from(projectInfraConfigs)
      .where(isNotNull(projectInfraConfigs.neonProjectId));

    for (const { projectId } of linkedProjects) {
      try {
        await usageService.collectNeonUsageForProject(projectId);
      } catch (err) {
        console.error(`Usage collection failed for project ${projectId}:`, err);
      }
    }
  });

  console.log("Usage collection scheduler started (daily at 3am SGT)");
}

export function stopUsageScheduler(): void {
  usageCollectionCron?.stop();
  usageCollectionCron = null;
}
