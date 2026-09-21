import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import type { UpsertProjectInfraConfigInput } from "@community-os/shared/validators";
import { api } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth";

const infraSearchSchema = z.object({
  projectId: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/dashboard/infra")({
  component: InfraPage,
  validateSearch: infraSearchSchema,
});

interface ProjectOption {
  id: string;
  name: string;
  slug: string;
  isEndorsed: boolean | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  members: Array<{ id: string; name: string; role: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-500",
  revoked: "bg-red-500/10 text-red-500",
  expired: "bg-muted text-muted-foreground",
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function InfraPage() {
  const { user } = useAuth();
  const searchParams = Route.useSearch();
  const navigate = Route.useNavigate();
  const selectedProjectId = searchParams.projectId ?? null;

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await api.api.v1.members.me.get();
      if (res.error) throw new Error("Failed to fetch profile");
      return res.data;
    },
  });

  const isAdmin =
    meData?.user?.role === "admin" || meData?.user?.role === "superadmin";

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", "infra-picker"],
    queryFn: async () => {
      const res = await api.api.v1.projects.get({
        query: { page: 1, limit: 100 },
      });
      if (res.error) throw new Error("Failed to fetch projects");
      return res.data;
    },
  });

  const endorsedProjects = (
    (projectsData?.projects ?? []) as ProjectOption[]
  ).filter((p) => p.isEndorsed);

  const selectProject = (id: string) => {
    navigate({
      search: (prev) => ({ ...prev, projectId: id || undefined }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Infrastructure
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage PR preview infrastructure for endorsed projects.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm p-4">
        <label
          htmlFor="infra-project-picker"
          className="text-sm font-medium text-foreground"
        >
          Project
        </label>
        {projectsLoading ? (
          <div className="mt-2 flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">
              Loading projects...
            </span>
          </div>
        ) : endorsedProjects.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No endorsed projects yet. Only endorsed projects can have PR preview
            infrastructure configured.
          </p>
        ) : (
          <select
            id="infra-project-picker"
            value={selectedProjectId ?? ""}
            onChange={(e) => selectProject(e.target.value)}
            className="mt-1 w-full max-w-sm px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground"
          >
            <option value="">Select a project...</option>
            {endorsedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedProjectId ? (
        <ProjectInfraSections
          key={selectedProjectId}
          projectId={selectedProjectId}
          isAdmin={isAdmin}
          currentUserId={user?.id ?? null}
        />
      ) : (
        <div className="bg-card rounded-xl border shadow-sm">
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground">
              Select a project
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Pick an endorsed project above to view or manage its PR preview
              infrastructure.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectInfraSections({
  projectId,
  isAdmin,
  currentUserId,
}: {
  projectId: string;
  isAdmin: boolean;
  currentUserId: string | null;
}) {
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await api.api.v1.projects({ id: projectId }).get();
      if (res.error) throw new Error("Failed to fetch project");
      return res.data as ProjectDetail;
    },
  });

  const currentUserProjectRole = project?.members?.find(
    (m) => m.id === currentUserId,
  )?.role;

  const canManageInfra =
    isAdmin ||
    currentUserProjectRole === "owner" ||
    currentUserProjectRole === "maintainer";

  return (
    <div className="space-y-6">
      <InfraConfigSection projectId={projectId} canManage={canManageInfra} />
      <PrPreviewEnvironmentsSection
        projectId={projectId}
        canManage={canManageInfra}
      />
    </div>
  );
}

function InfraConfigSection({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [creatingNeon, setCreatingNeon] = useState(false);
  const [newNeonName, setNewNeonName] = useState("");
  const [creatingRailway, setCreatingRailway] = useState(false);
  const [newRailwayName, setNewRailwayName] = useState("");

  const configQuery = useQuery({
    queryKey: ["project-infra-config", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"].get();
      if (res.error) throw new Error("Failed to fetch infra config");
      return res.data;
    },
  });
  const config = configQuery.data?.config ?? null;

  const neonProjectsQuery = useQuery({
    queryKey: ["neon-projects", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["neon-projects"].get();
      if (res.error) throw new Error("Failed to fetch Neon projects");
      return res.data;
    },
    enabled: canManage,
  });

  const railwayProjectsQuery = useQuery({
    queryKey: ["railway-projects", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["railway-projects"].get();
      if (res.error) throw new Error("Failed to fetch Railway projects");
      return res.data;
    },
    enabled: canManage,
  });

  const railwayServicesQuery = useQuery({
    queryKey: ["railway-services", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["railway-services"].get();
      if (res.error) throw new Error("Failed to fetch Railway services");
      return res.data;
    },
    enabled: canManage && !!config?.railwayProjectId,
  });

  const railwayEnvironmentsQuery = useQuery({
    queryKey: ["railway-environments", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["railway-environments"].get();
      if (res.error) throw new Error("Failed to fetch Railway environments");
      return res.data;
    },
    enabled: canManage && !!config?.railwayProjectId,
  });

  const invalidateConfig = () =>
    queryClient.invalidateQueries({
      queryKey: ["project-infra-config", projectId],
    });

  const patchMutation = useMutation({
    mutationFn: async (patch: UpsertProjectInfraConfigInput) => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"].put(patch);
      if (res.error) throw new Error("Failed to update infra config");
      return res.data;
    },
    onSuccess: invalidateConfig,
  });

  const createNeonMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["neon-projects"].post({ name });
      if (res.error) throw new Error("Failed to create Neon project");
      return res.data;
    },
    onSuccess: () => {
      setCreatingNeon(false);
      setNewNeonName("");
      invalidateConfig();
      queryClient.invalidateQueries({ queryKey: ["neon-projects", projectId] });
    },
  });

  const createRailwayMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["railway-projects"].post({ name });
      if (res.error) throw new Error("Failed to create Railway project");
      return res.data;
    },
    onSuccess: () => {
      setCreatingRailway(false);
      setNewRailwayName("");
      invalidateConfig();
      queryClient.invalidateQueries({
        queryKey: ["railway-projects", projectId],
      });
    },
  });

  const selectClass =
    "mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground disabled:opacity-60 disabled:cursor-not-allowed";
  const inputClass =
    "mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground";

  const fullyLinked = Boolean(
    config?.neonProjectId &&
      config?.railwayProjectId &&
      config?.railwayServiceId &&
      config?.railwaySourceEnvironmentId,
  );

  return (
    <div className="bg-card rounded-xl border shadow-sm p-5">
      <h2 className="text-sm font-semibold text-foreground">Infra Config</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Link a Neon project and a Railway project once — every PR preview after
        that provisions and tears down automatically, with no more manual Neon
        or Railway dashboard steps.
      </p>

      {configQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="neon-project-select"
              className="text-sm font-medium text-foreground"
            >
              Neon Project
            </label>
            {creatingNeon ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  value={newNeonName}
                  onChange={(e) => setNewNeonName(e.target.value)}
                  placeholder="New Neon project name"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => createNeonMutation.mutate(newNeonName)}
                  disabled={!newNeonName || createNeonMutation.isPending}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {createNeonMutation.isPending ? "..." : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingNeon(false)}
                  className="px-3 py-2 text-xs font-medium rounded-lg border text-foreground hover:bg-accent transition-colors flex-shrink-0"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <select
                  id="neon-project-select"
                  value={config?.neonProjectId ?? ""}
                  onChange={(e) =>
                    patchMutation.mutate({
                      neonProjectId: e.target.value || null,
                    })
                  }
                  disabled={!canManage || neonProjectsQuery.isLoading}
                  className={selectClass}
                >
                  <option value="">Not linked</option>
                  {(neonProjectsQuery.data?.projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setCreatingNeon(true)}
                    className="px-3 py-2 text-xs font-medium rounded-lg border text-foreground hover:bg-accent transition-colors flex-shrink-0"
                  >
                    New
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="railway-project-select"
              className="text-sm font-medium text-foreground"
            >
              Railway Project
            </label>
            {creatingRailway ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  value={newRailwayName}
                  onChange={(e) => setNewRailwayName(e.target.value)}
                  placeholder="New Railway project name"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => createRailwayMutation.mutate(newRailwayName)}
                  disabled={!newRailwayName || createRailwayMutation.isPending}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {createRailwayMutation.isPending ? "..." : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingRailway(false)}
                  className="px-3 py-2 text-xs font-medium rounded-lg border text-foreground hover:bg-accent transition-colors flex-shrink-0"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <select
                  id="railway-project-select"
                  value={config?.railwayProjectId ?? ""}
                  onChange={(e) =>
                    patchMutation.mutate({
                      railwayProjectId: e.target.value || null,
                      // Switching projects invalidates whatever service/env
                      // was picked for the old one.
                      railwayServiceId: null,
                      railwaySourceEnvironmentId: null,
                    })
                  }
                  disabled={!canManage || railwayProjectsQuery.isLoading}
                  className={selectClass}
                >
                  <option value="">Not linked</option>
                  {(railwayProjectsQuery.data?.projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setCreatingRailway(true)}
                    className="px-3 py-2 text-xs font-medium rounded-lg border text-foreground hover:bg-accent transition-colors flex-shrink-0"
                  >
                    New
                  </button>
                )}
              </div>
            )}
          </div>

          {config?.railwayProjectId && (
            <>
              <div>
                <label
                  htmlFor="railway-service-select"
                  className="text-sm font-medium text-foreground"
                >
                  Railway Service
                </label>
                <select
                  id="railway-service-select"
                  value={config?.railwayServiceId ?? ""}
                  onChange={(e) =>
                    patchMutation.mutate({
                      railwayServiceId: e.target.value || null,
                    })
                  }
                  disabled={!canManage || railwayServicesQuery.isLoading}
                  className={selectClass}
                >
                  <option value="">Select a service...</option>
                  {(railwayServicesQuery.data?.services ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="railway-env-select"
                  className="text-sm font-medium text-foreground"
                >
                  Clones From (Source Environment)
                </label>
                <select
                  id="railway-env-select"
                  value={config?.railwaySourceEnvironmentId ?? ""}
                  onChange={(e) =>
                    patchMutation.mutate({
                      railwaySourceEnvironmentId: e.target.value || null,
                    })
                  }
                  disabled={!canManage || railwayEnvironmentsQuery.isLoading}
                  className={selectClass}
                >
                  <option value="">Select an environment...</option>
                  {(railwayEnvironmentsQuery.data?.environments ?? [])
                    .filter((e) => !e.isEphemeral)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </div>
            </>
          )}
        </div>
      )}

      {!configQuery.isLoading && (
        <p
          className={`mt-4 text-xs ${fullyLinked ? "text-emerald-500" : "text-muted-foreground"}`}
        >
          {fullyLinked
            ? "Fully automated — PR previews for this project provision and tear down with zero manual Neon/Railway steps."
            : "Link a Neon project and a Railway project + service + source environment to fully automate PR previews."}
        </p>
      )}
    </div>
  );
}

function PrPreviewEnvironmentsSection({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["dev-environments", projectId],
    queryFn: async () => {
      const res = await api.api.v1["dev-environments"].get({
        query: { projectId },
      });
      if (res.error) throw new Error("Failed to fetch environments");
      return res.data;
    },
  });

  const environments = data?.environments ?? [];
  const previewEnvironments = environments.filter((e) => e.prNumber !== null);

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.v1["dev-environments"]({ id }).revoke.post();
      if (res.error) throw new Error("Failed to revoke environment");
      return res.data;
    },
    onSuccess: () => {
      setConfirmRevokeId(null);
      queryClient.invalidateQueries({
        queryKey: ["dev-environments", projectId],
      });
    },
  });

  return (
    <div className="bg-card rounded-xl border shadow-sm p-5">
      <h2 className="text-sm font-semibold text-foreground">
        PR Preview Environments
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Environments provisioned automatically for open pull requests. They are
        torn down automatically when the PR closes; revoking here is a manual
        override.
      </p>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : previewEnvironments.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No PR preview environments yet.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {previewEnvironments.map((env) => (
            <div
              key={env.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    PR #{env.prNumber}
                  </span>
                  <span
                    className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      (env.status && STATUS_COLORS[env.status]) ??
                      "bg-muted text-muted-foreground"
                    }`}
                  >
                    {env.status ?? "unknown"}
                  </span>
                  {env.label && (
                    <span className="text-xs text-muted-foreground truncate">
                      {env.label}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Created {formatDate(env.createdAt)}
                  {env.revokedAt && <> · Revoked {formatDate(env.revokedAt)}</>}
                </p>
              </div>
              {canManage && env.status === "active" && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmRevokeId === env.id ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        Revoke?
                      </span>
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(env.id)}
                        disabled={revokeMutation.isPending}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                      >
                        {revokeMutation.isPending ? "..." : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(null)}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border text-foreground hover:bg-accent transition-colors"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeId(env.id)}
                      className="px-2.5 py-1 text-xs font-medium rounded-md border text-foreground hover:bg-accent transition-colors"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
