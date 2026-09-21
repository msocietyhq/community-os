import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";

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
      <BootstrapTokensSection
        projectId={projectId}
        canManage={canManageInfra}
      />
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
  const [neonProjectId, setNeonProjectId] = useState("");
  const [railwayProjectId, setRailwayProjectId] = useState("");
  const [railwayServiceId, setRailwayServiceId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["project-infra-config", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"].get();
      if (res.error) throw new Error("Failed to fetch infra config");
      return res.data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setNeonProjectId(data.config?.neonProjectId ?? "");
    setRailwayProjectId(data.config?.railwayProjectId ?? "");
    setRailwayServiceId(data.config?.railwayServiceId ?? "");
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"].put({
          neonProjectId: neonProjectId || undefined,
          railwayProjectId: railwayProjectId || undefined,
          railwayServiceId: railwayServiceId || undefined,
        });
      if (res.error) throw new Error("Failed to save infra config");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-infra-config", projectId],
      });
    },
  });

  return (
    <div className="bg-card rounded-xl border shadow-sm p-5">
      <h2 className="text-sm font-semibold text-foreground">Infra Config</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The Neon and Railway resources this project's PR preview environments
        get provisioned into.
      </p>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="neon-project-id"
                className="text-sm font-medium text-foreground"
              >
                Neon Project ID
              </label>
              <input
                id="neon-project-id"
                type="text"
                value={neonProjectId}
                onChange={(e) => setNeonProjectId(e.target.value)}
                disabled={!canManage}
                placeholder="neon-project-id"
                className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="railway-project-id"
                className="text-sm font-medium text-foreground"
              >
                Railway Project ID
              </label>
              <input
                id="railway-project-id"
                type="text"
                value={railwayProjectId}
                onChange={(e) => setRailwayProjectId(e.target.value)}
                disabled={!canManage}
                placeholder="railway-project-id"
                className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="railway-service-id"
                className="text-sm font-medium text-foreground"
              >
                Railway Service ID
              </label>
              <input
                id="railway-service-id"
                type="text"
                value={railwayServiceId}
                onChange={(e) => setRailwayServiceId(e.target.value)}
                disabled={!canManage}
                placeholder="railway-service-id"
                className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {canManage && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saveMutation.isPending ? "Saving..." : "Save Config"}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function BootstrapTokensSection({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [newTokenOpen, setNewTokenOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["project-bootstrap-tokens", projectId],
    queryFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["bootstrap-tokens"].get();
      if (res.error) throw new Error("Failed to fetch bootstrap tokens");
      return res.data;
    },
    enabled: canManage,
  });

  const tokens = data?.tokens ?? [];

  const issueMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["bootstrap-tokens"].post({
          label: label || undefined,
        });
      if (res.error) throw new Error("Failed to issue bootstrap token");
      return res.data;
    },
    onSuccess: (result) => {
      setIssuedToken(result?.token ?? null);
      setLabel("");
      queryClient.invalidateQueries({
        queryKey: ["project-bootstrap-tokens", projectId],
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const res = await api.api.v1
        .projects({ id: projectId })
        ["infra-config"]["bootstrap-tokens"]({ tokenId })
        .revoke.post();
      if (res.error) throw new Error("Failed to revoke bootstrap token");
      return res.data;
    },
    onSuccess: () => {
      setConfirmRevokeId(null);
      queryClient.invalidateQueries({
        queryKey: ["project-bootstrap-tokens", projectId],
      });
    },
  });

  const closeDialog = () => {
    setNewTokenOpen(false);
    setLabel("");
    setIssuedToken(null);
    setCopied(false);
  };

  if (!canManage) return null;

  return (
    <div className="bg-card rounded-xl border shadow-sm p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Bootstrap Tokens
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The credential this project's Railway service clones into every PR
            preview environment.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewTokenOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          New Token
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : tokens.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No bootstrap tokens yet.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {token.label || "Untitled token"}
                  </span>
                  {token.revokedAt ? (
                    <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-500">
                      Revoked
                    </span>
                  ) : (
                    <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Created {formatDate(token.createdAt)}
                  {" · "}
                  Last used {formatDate(token.lastUsedAt)}
                </p>
              </div>
              {!token.revokedAt && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmRevokeId === token.id ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        Revoke?
                      </span>
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(token.id)}
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
                      onClick={() => setConfirmRevokeId(token.id)}
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

      <Dialog open={newTokenOpen} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Bootstrap Token</DialogTitle>
            <DialogDescription>
              {issuedToken
                ? "Copy this token now — it will not be shown again."
                : "Optionally label this token, then issue it."}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            {issuedToken ? (
              <>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    This is the only time this token will be shown. Copy it now
                    and store it somewhere safe.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 text-xs bg-muted rounded-lg text-foreground break-all">
                    {issuedToken}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(issuedToken);
                      setCopied(true);
                    }}
                    className="px-3 py-2 text-xs font-medium rounded-lg border bg-card text-foreground hover:bg-accent transition-colors flex-shrink-0"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  issueMutation.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <label
                    htmlFor="token-label"
                    className="text-sm font-medium text-foreground"
                  >
                    Label
                  </label>
                  <input
                    id="token-label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Railway PR previews"
                    className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="px-4 py-2 text-sm font-medium rounded-lg border bg-card text-foreground hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={issueMutation.isPending}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {issueMutation.isPending ? "Issuing..." : "Issue Token"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
