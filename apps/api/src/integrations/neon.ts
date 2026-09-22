// Neon API integration for PR preview database provisioning (issue #52).
//
// Only NEON_API_KEY (this API's own, never a per-repo secret) plus a
// project's `neonProjectId` (a non-secret identifier, stored in
// `project_infra_configs`) are needed to fork/delete a branch. Branch
// forking copies the parent branch's schema and data, so a fresh branch is
// already usable; migrations only need re-running when the PR itself adds
// ones not yet on the parent (see `runMigrations`).
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

export interface NeonBranchResult {
  branchId: string;
  databaseUrl: string;
}

function requireApiKey(): string {
  if (!env.NEON_API_KEY) {
    throw new Error(
      "NEON_API_KEY is not configured — cannot provision Neon branches",
    );
  }
  return env.NEON_API_KEY;
}

/**
 * A PR preview branch's safety-net TTL: 30 days is Neon's own documented
 * maximum expiration horizon (`expires_at` can't be set further out than
 * that), so it's also the longest this can protect against an orphaned
 * branch outliving a PR that never triggered `ci/teardown` — a workflow
 * removed from a caller repo, a rotated CI token, teardown itself failing.
 * The normal path is still `teardownPreviewEnvironment` deleting the branch
 * immediately when the PR closes; this only bounds the worst case.
 */
function thirtyDaysFromNow(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
}

/** Carries the HTTP status and raw body so callers can react to a specific Neon error code (e.g. `BRANCH_ALREADY_EXISTS`) instead of string-matching a formatted message. */
export class NeonApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "NeonApiError";
  }
}

async function neonRequest<T>(apiPath: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${NEON_API_BASE}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NeonApiError(
      res.status,
      body,
      `Neon API ${init?.method ?? "GET"} ${apiPath} failed: ${res.status} ${body}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface NeonProject {
  id: string;
  name: string;
}

interface NeonProjectsListResponse {
  projects: Array<{ id: string; name: string }>;
}
interface NeonProjectResponse {
  project: { id: string; name: string };
}
interface NeonBranchResponse {
  branch: { id: string };
}
interface NeonBranchListResponse {
  branches: Array<{ id: string; name: string }>;
}
interface NeonDatabasesResponse {
  databases: Array<{ name: string }>;
}
interface NeonRolesResponse {
  roles: Array<{ name: string }>;
}
interface NeonConnectionUriResponse {
  uri: string;
}

export type NeonConsumptionMetric =
  | "compute_unit_seconds"
  | "root_branch_bytes_month"
  | "child_branch_bytes_month"
  | "instant_restore_bytes_month"
  | "public_network_transfer_bytes"
  | "private_network_transfer_bytes";

export interface NeonBranchConsumption {
  branchId: string;
  periodStart: string;
  periodEnd: string;
  metricName: string;
  value: number;
}

interface NeonConsumptionHistoryResponse {
  branches: Array<{
    branch_id: string;
    periods: Array<{
      period_start: string;
      period_end: string;
      consumption: Array<{
        metrics: Array<{ metric_name: string; value: number }>;
      }>;
    }>;
  }>;
}

function requireOrgId(): string {
  if (!env.NEON_ORG_ID) {
    throw new Error(
      "NEON_ORG_ID is not configured — cannot fetch Neon consumption metrics",
    );
  }
  return env.NEON_ORG_ID;
}

export const neonClient = {
  /** Every Neon project on this account — so an admin can link an existing one instead of typing an ID. */
  async listProjects(): Promise<NeonProject[]> {
    const data = await neonRequest<NeonProjectsListResponse>("/projects");
    return data.projects.map((p) => ({ id: p.id, name: p.name }));
  },

  async createProject(name: string): Promise<NeonProject> {
    const data = await neonRequest<NeonProjectResponse>("/projects", {
      method: "POST",
      body: JSON.stringify({ project: { name } }),
    });
    return data.project;
  },

  /**
   * Forks `branchName` off the project's default branch with a read-write
   * compute endpoint, and returns a ready-to-use pooled connection string.
   *
   * If a branch with this name already exists (a prior `ensure` attempt
   * forked it but failed on a later step — migrations, Railway — before
   * that attempt's own `dev_environments` row was persisted), reuses it
   * instead of erroring forever: there's no local record to short-circuit
   * on, but the orphaned branch still blocks re-creation.
   */
  async createBranch(
    neonProjectId: string,
    branchName: string,
  ): Promise<NeonBranchResult> {
    let branchId: string;
    try {
      const { branch } = await neonRequest<NeonBranchResponse>(
        `/projects/${neonProjectId}/branches`,
        {
          method: "POST",
          body: JSON.stringify({
            branch: { name: branchName, expires_at: thirtyDaysFromNow() },
            endpoints: [{ type: "read_write" }],
          }),
        },
      );
      branchId = branch.id;
    } catch (err) {
      const isAlreadyExists =
        err instanceof NeonApiError &&
        err.status === 409 &&
        err.body.includes("BRANCH_ALREADY_EXISTS");
      if (!isAlreadyExists) throw err;

      const { branches } = await neonRequest<NeonBranchListResponse>(
        `/projects/${neonProjectId}/branches`,
      );
      const existing = branches.find((b) => b.name === branchName);
      if (!existing) throw err;
      branchId = existing.id;

      // Reusing a branch orphaned by an earlier failed attempt — push its
      // TTL back out rather than leaving whatever expiry it was created
      // with, since this PR is evidently still active.
      try {
        await neonRequest(`/projects/${neonProjectId}/branches/${branchId}`, {
          method: "PATCH",
          body: JSON.stringify({
            branch: { expires_at: thirtyDaysFromNow() },
          }),
        });
      } catch (patchErr) {
        console.warn(
          `Failed to refresh expiry on reused Neon branch ${branchId}:`,
          patchErr,
        );
      }
    }

    const [{ databases }, { roles }] = await Promise.all([
      neonRequest<NeonDatabasesResponse>(
        `/projects/${neonProjectId}/branches/${branchId}/databases`,
      ),
      neonRequest<NeonRolesResponse>(
        `/projects/${neonProjectId}/branches/${branchId}/roles`,
      ),
    ]);
    const database = databases[0]?.name;
    const role = roles[0]?.name;
    if (!database || !role) {
      throw new Error(
        `Neon branch ${branchId} has no database/role to build a connection string from`,
      );
    }

    const { uri } = await neonRequest<NeonConnectionUriResponse>(
      `/projects/${neonProjectId}/connection_uri?branch_id=${branchId}&database_name=${encodeURIComponent(database)}&role_name=${encodeURIComponent(role)}&pooled=true`,
    );

    return { branchId, databaseUrl: uri };
  },

  /** Idempotent-ish from the caller's side: deleting an already-gone branch 404s, which callers should treat as success. */
  async deleteBranch(neonProjectId: string, branchId: string): Promise<void> {
    await neonRequest(`/projects/${neonProjectId}/branches/${branchId}`, {
      method: "DELETE",
    });
  },

  /**
   * Real per-branch compute/storage consumption for a time window — the one
   * piece of PR-preview cost that's actually attributable to a specific
   * branch via a documented API (issue #52 follow-up / ADR-010). Requires a
   * paid usage-based Neon plan; returns an empty array on plans that don't
   * expose it rather than throwing, so a foundation feature doesn't break
   * provisioning for accounts that don't have it.
   */
  async getBranchConsumption(input: {
    neonProjectId: string;
    branchIds: string[];
    from: Date;
    to: Date;
    granularity: "hourly" | "daily" | "monthly";
    metrics: NeonConsumptionMetric[];
  }): Promise<NeonBranchConsumption[]> {
    if (input.branchIds.length === 0) return [];

    const params = new URLSearchParams();
    params.set("org_id", requireOrgId());
    params.append("project_ids", input.neonProjectId);
    for (const id of input.branchIds) params.append("branch_ids", id);
    for (const m of input.metrics) params.append("metrics", m);
    params.set("from", input.from.toISOString());
    params.set("to", input.to.toISOString());
    params.set("granularity", input.granularity);

    let data: NeonConsumptionHistoryResponse;
    try {
      data = await neonRequest<NeonConsumptionHistoryResponse>(
        `/consumption_history/v2/branches?${params.toString()}`,
      );
    } catch (err) {
      console.warn(
        `Neon consumption metrics unavailable for project ${input.neonProjectId} (likely not on a usage-based plan):`,
        err,
      );
      return [];
    }

    return data.branches.flatMap((branch) =>
      branch.periods.flatMap((period) =>
        period.consumption.flatMap((c) =>
          c.metrics.map((m) => ({
            branchId: branch.branch_id,
            periodStart: period.period_start,
            periodEnd: period.period_end,
            metricName: m.metric_name,
            value: m.value,
          })),
        ),
      ),
    );
  },
};

const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");

/**
 * Applies this repo's own Drizzle migrations against a freshly forked
 * branch. Needed when the PR that triggered provisioning adds migrations
 * that haven't landed on the parent branch yet — a branch fork alone only
 * copies what's already there.
 */
export async function runMigrationsOn(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
