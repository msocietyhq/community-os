import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  devEnvironments,
  projectInfraConfigs,
  resourceUsageSnapshots,
} from "../db/schema";
import type { NeonConsumptionMetric } from "../integrations/neon";
import { neonClient } from "../integrations/neon";

const NEON_METRICS: NeonConsumptionMetric[] = [
  "compute_unit_seconds",
  "root_branch_bytes_month",
  "child_branch_bytes_month",
];

export const usageService = {
  /**
   * Pulls Neon's own consumption numbers for every PR-preview branch this
   * project still has a `dev_environments` row for (active or recently
   * revoked — a torn-down branch's last known usage is still worth
   * recording) and appends them as snapshots. Returns how many metric rows
   * it stored, so a caller (cron or "refresh now") can tell a no-op from
   * a real pull.
   */
  async collectNeonUsageForProject(
    projectId: string,
    window: { from: Date; to: Date } = {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
    },
  ): Promise<number> {
    const [infraConfig] = await db
      .select()
      .from(projectInfraConfigs)
      .where(eq(projectInfraConfigs.projectId, projectId));

    if (!infraConfig?.neonProjectId) return 0;

    const environments = await db
      .select({
        id: devEnvironments.id,
        neonBranchId: devEnvironments.neonBranchId,
      })
      .from(devEnvironments)
      .where(
        and(
          eq(devEnvironments.projectId, projectId),
          isNotNull(devEnvironments.neonBranchId),
        ),
      );

    if (environments.length === 0) return 0;

    const branchToEnvironmentId = new Map(
      environments.map((e) => [e.neonBranchId as string, e.id]),
    );

    const consumption = await neonClient.getBranchConsumption({
      neonProjectId: infraConfig.neonProjectId,
      branchIds: [...branchToEnvironmentId.keys()],
      from: window.from,
      to: window.to,
      granularity: "daily",
      metrics: NEON_METRICS,
    });

    if (consumption.length === 0) return 0;

    await db.insert(resourceUsageSnapshots).values(
      consumption.map((c) => ({
        projectId,
        devEnvironmentId: branchToEnvironmentId.get(c.branchId) ?? null,
        source: "neon" as const,
        metricName: c.metricName,
        value: c.value.toString(),
        periodStart: new Date(c.periodStart),
        periodEnd: new Date(c.periodEnd),
      })),
    );

    return consumption.length;
  },

  /**
   * Rolls up stored snapshots per environment over the trailing window.
   * `compute_unit_seconds` is a flow metric (summed across periods);
   * `*_bytes_month` metrics are point-in-time snapshots (most recent wins).
   * No dollar conversion — see ADR-010 on why that's not attempted here.
   */
  async getUsageSummary(projectId: string, sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        devEnvironmentId: resourceUsageSnapshots.devEnvironmentId,
        metricName: resourceUsageSnapshots.metricName,
        value: resourceUsageSnapshots.value,
        periodEnd: resourceUsageSnapshots.periodEnd,
      })
      .from(resourceUsageSnapshots)
      .where(
        and(
          eq(resourceUsageSnapshots.projectId, projectId),
          gte(resourceUsageSnapshots.periodEnd, since),
        ),
      );

    interface EnvUsage {
      devEnvironmentId: string | null;
      totals: Record<string, number>;
      latest: Record<string, { value: number; periodEnd: Date }>;
    }
    const byEnvironment = new Map<string, EnvUsage>();

    for (const row of rows) {
      const key = row.devEnvironmentId ?? "project-level";
      let entry = byEnvironment.get(key);
      if (!entry) {
        entry = {
          devEnvironmentId: row.devEnvironmentId,
          totals: {},
          latest: {},
        };
        byEnvironment.set(key, entry);
      }
      const value = Number(row.value);
      entry.totals[row.metricName] =
        (entry.totals[row.metricName] ?? 0) + value;
      const prevLatest = entry.latest[row.metricName];
      if (!prevLatest || row.periodEnd > prevLatest.periodEnd) {
        entry.latest[row.metricName] = { value, periodEnd: row.periodEnd };
      }
    }

    return [...byEnvironment.values()].map((e) => ({
      devEnvironmentId: e.devEnvironmentId,
      totals: e.totals,
      latest: Object.fromEntries(
        Object.entries(e.latest).map(([metric, v]) => [metric, v.value]),
      ),
    }));
  },
};
