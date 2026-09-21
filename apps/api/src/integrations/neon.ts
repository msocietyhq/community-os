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
    throw new Error(
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
interface NeonDatabasesResponse {
  databases: Array<{ name: string }>;
}
interface NeonRolesResponse {
  roles: Array<{ name: string }>;
}
interface NeonConnectionUriResponse {
  uri: string;
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
   */
  async createBranch(
    neonProjectId: string,
    branchName: string,
  ): Promise<NeonBranchResult> {
    const { branch } = await neonRequest<NeonBranchResponse>(
      `/projects/${neonProjectId}/branches`,
      {
        method: "POST",
        body: JSON.stringify({
          branch: { name: branchName },
          endpoints: [{ type: "read_write" }],
        }),
      },
    );

    const [{ databases }, { roles }] = await Promise.all([
      neonRequest<NeonDatabasesResponse>(
        `/projects/${neonProjectId}/branches/${branch.id}/databases`,
      ),
      neonRequest<NeonRolesResponse>(
        `/projects/${neonProjectId}/branches/${branch.id}/roles`,
      ),
    ]);
    const database = databases[0]?.name;
    const role = roles[0]?.name;
    if (!database || !role) {
      throw new Error(
        `Neon branch ${branch.id} has no database/role to build a connection string from`,
      );
    }

    const { uri } = await neonRequest<NeonConnectionUriResponse>(
      `/projects/${neonProjectId}/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(database)}&role_name=${encodeURIComponent(role)}&pooled=true`,
    );

    return { branchId: branch.id, databaseUrl: uri };
  },

  /** Idempotent-ish from the caller's side: deleting an already-gone branch 404s, which callers should treat as success. */
  async deleteBranch(neonProjectId: string, branchId: string): Promise<void> {
    await neonRequest(`/projects/${neonProjectId}/branches/${branchId}`, {
      method: "DELETE",
    });
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
