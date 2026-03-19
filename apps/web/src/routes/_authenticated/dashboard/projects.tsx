import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { api } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import type {
  ProjectNature,
  ProjectStatus,
  ProjectPlatform,
} from "@community-os/shared/constants";

export const Route = createFileRoute("/_authenticated/dashboard/projects")({
  component: ProjectsPage,
});

type NatureFilter = "all" | ProjectNature;
type DialogMode = "view" | "edit" | "create";

const NATURE_LABELS: Record<string, string> = {
  startup: "Startup",
  community: "Community",
  side_project: "Side Project",
};

/** SVG path data for nature icons (heroicons-style) */
const NATURE_ICON_PATHS: Record<string, string> = {
  startup:
    "M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
  community:
    "M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z",
  side_project:
    "M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437",
};

const PLATFORM_LABELS: Record<string, string> = {
  web_app: "Web App",
  mobile_app: "Mobile App",
  mobile_game: "Mobile Game",
  telegram_bot: "Telegram Bot",
  library: "Library",
  other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-500",
  paused: "bg-amber-500/10 text-amber-500",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

function NatureIcon({
  nature,
  className = "w-4 h-4",
}: {
  nature: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={
          NATURE_ICON_PATHS[nature] ??
          "M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
        }
      />
    </svg>
  );
}

function ProjectsPage() {
  const { user } = useAuth();
  const [natureFilter, setNatureFilter] = useState<NatureFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [dialogMode, setDialogMode] = useState<DialogMode>("view");
  const [dialogOpen, setDialogOpen] = useState(false);
  const limit = 20;

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

  const { data, isLoading } = useQuery({
    queryKey: ["projects", natureFilter, page],
    queryFn: async () => {
      const query: {
        page: number;
        limit: number;
        nature?: ProjectNature;
      } = { page, limit };
      if (natureFilter !== "all") {
        query.nature = natureFilter;
      }
      const res = await api.api.v1.projects.get({ query });
      if (res.error) throw new Error("Failed to fetch projects");
      return res.data;
    },
  });

  const projects = data?.projects ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const openProjectDetail = (id: string) => {
    setSelectedProjectId(id);
    setDialogMode("view");
    setDialogOpen(true);
  };

  const openCreate = () => {
    setSelectedProjectId(null);
    setDialogMode("create");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedProjectId(null);
    setDialogMode("view");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total > 0
              ? `${total} project${total === 1 ? "" : "s"} built by MSOCIETY members`
              : "Community projects built by MSOCIETY members."}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
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
          Create Project
        </button>
      </div>

      {/* Nature filter tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {(["all", "startup", "community", "side_project"] as const).map(
          (f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setNatureFilter(f);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                natureFilter === f
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : NATURE_LABELS[f]}
            </button>
          ),
        )}
      </div>

      {/* Projects grid */}
      {isLoading ? (
        <div className="bg-card rounded-xl border shadow-sm flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">
              Loading projects...
            </span>
          </div>
        </div>
      ) : projects.length === 0 ? (
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
                  d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground">
              {natureFilter === "all"
                ? "No projects yet"
                : `No ${NATURE_LABELS[natureFilter]?.toLowerCase()} projects`}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Community-built projects and open-source collaborations will
              appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => openProjectDetail(project.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border bg-card text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border bg-card text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Unified project dialog */}
      <ProjectDialog
        projectId={selectedProjectId}
        mode={dialogMode}
        open={dialogOpen}
        onClose={closeDialog}
        onModeChange={setDialogMode}
        isAdmin={isAdmin}
        currentUserId={user?.id ?? null}
      />
    </div>
  );
}

function ProjectCard({
  project,
  onClick,
}: {
  project: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    nature: string;
    platforms: string[] | null;
    status: string | null;
    url?: string | null;
    repoUrl?: string | null;
    isEndorsed: boolean | null;
    createdAt: string | Date | null;
    memberCount: number;
  };
  onClick: () => void;
}) {
  const createdDate = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString("en-SG", {
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card rounded-xl border shadow-sm p-5 transition-colors hover:bg-accent/30 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <NatureIcon
              nature={project.nature}
              className="w-4 h-4 text-muted-foreground"
            />
          </div>
          <h3 className="text-sm font-semibold text-foreground truncate">
            {project.name}
          </h3>
          {project.isEndorsed && (
            <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-500">
              Endorsed
            </span>
          )}
        </div>
        <span
          className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${(project.status && STATUS_COLORS[project.status]) ?? "bg-muted text-muted-foreground"}`}
        >
          {(project.status && STATUS_LABELS[project.status]) ?? project.status ?? "unknown"}
        </span>
      </div>

      {project.description && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {project.description}
        </p>
      )}

      {project.platforms && project.platforms.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {project.platforms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground"
            >
              {PLATFORM_LABELS[p] ?? p}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
            />
          </svg>
          {project.memberCount} member{project.memberCount === 1 ? "" : "s"}
        </span>
        <span>{NATURE_LABELS[project.nature] ?? project.nature}</span>
        <span>{createdDate}</span>
      </div>
    </button>
  );
}

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  nature: string;
  platforms: string[] | null;
  status: string | null;
  url?: string | null;
  repoUrl?: string | null;
  thumbnailUrl?: string | null;
  isEndorsed: boolean | null;
  endorsedAt?: string | Date | null;
  createdAt: string | Date;
  members: Array<{
    id: string;
    name: string;
    image?: string | null;
    role: string;
  }>;
}

function ProjectDialog({
  projectId,
  mode,
  open,
  onClose,
  onModeChange,
  isAdmin,
  currentUserId,
}: {
  projectId: string | null;
  mode: DialogMode;
  open: boolean;
  onClose: () => void;
  onModeChange: (mode: DialogMode) => void;
  isAdmin: boolean;
  currentUserId: string | null;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Form state for edit/create
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNature, setFormNature] = useState<ProjectNature>("side_project");
  const [formStatus, setFormStatus] = useState<ProjectStatus>("active");
  const [formPlatforms, setFormPlatforms] = useState<ProjectPlatform[]>([]);
  const [formUrl, setFormUrl] = useState("");
  const [formRepoUrl, setFormRepoUrl] = useState("");

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const res = await api.api.v1.projects({ id: projectId }).get();
      if (res.error) throw new Error("Failed to fetch project");
      return res.data as ProjectDetail;
    },
    enabled: open && !!projectId && mode !== "create",
  });

  const canManage =
    isAdmin ||
    (project?.members?.some(
      (m) => m.id === currentUserId && m.role === "owner",
    ) ??
      false);

  const startEditing = () => {
    if (!project) return;
    setFormName(project.name);
    setFormDescription(project.description ?? "");
    setFormNature(project.nature as ProjectNature);
    setFormStatus((project.status as ProjectStatus) ?? "active");
    setFormPlatforms((project.platforms as ProjectPlatform[]) ?? []);
    setFormUrl(project.url ?? "");
    setFormRepoUrl(project.repoUrl ?? "");
    onModeChange("edit");
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) return;
      const res = await api.api.v1.projects({ id: projectId }).patch({
        name: formName,
        description: formDescription || undefined,
        nature: formNature,
        status: formStatus,
        platforms: formPlatforms,
        url: formUrl || undefined,
        repoUrl: formRepoUrl || undefined,
      });
      if (res.error) throw new Error("Failed to update project");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onModeChange("view");
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.v1.projects.post({
        name: formName,
        description: formDescription || undefined,
        nature: formNature,
        platforms: formPlatforms,
        url: formUrl || undefined,
        repoUrl: formRepoUrl || undefined,
      });
      if (res.error) throw new Error("Failed to create project");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      resetForm();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) return;
      const res = await api.api.v1.projects({ id: projectId }).delete();
      if (res.error) throw new Error("Failed to delete project");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setConfirmDelete(false);
      onClose();
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormNature("side_project");
    setFormStatus("active");
    setFormPlatforms([]);
    setFormUrl("");
    setFormRepoUrl("");
  };

  const togglePlatform = (p: ProjectPlatform) => {
    setFormPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const handleClose = () => {
    setConfirmDelete(false);
    resetForm();
    onClose();
  };

  const isFormMode = mode === "edit" || mode === "create";
  const isPending =
    mode === "edit" ? updateMutation.isPending : createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        {mode === "view" && (isLoading || !project) ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isFormMode ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {mode === "create" ? "Create Project" : "Edit Project"}
              </DialogTitle>
              <DialogDescription>
                {mode === "create"
                  ? "Add a new community project."
                  : "Update project details."}
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === "create") {
                  createMutation.mutate();
                } else {
                  updateMutation.mutate();
                }
              }}
              className="px-6 pb-6 space-y-4"
            >
              <div>
                <label className="text-sm font-medium text-foreground">
                  Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  placeholder="My awesome project"
                  className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  placeholder="What does your project do?"
                  className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground resize-none placeholder:text-muted-foreground"
                />
              </div>

              <div className={mode === "edit" ? "grid grid-cols-2 gap-4" : ""}>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Nature
                  </label>
                  <select
                    value={formNature}
                    onChange={(e) =>
                      setFormNature(e.target.value as ProjectNature)
                    }
                    className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground"
                  >
                    {Object.entries(NATURE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {mode === "edit" && (
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Status
                    </label>
                    <select
                      value={formStatus}
                      onChange={(e) =>
                        setFormStatus(e.target.value as ProjectStatus)
                      }
                      className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground"
                    >
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  Platforms
                </label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(
                    Object.entries(PLATFORM_LABELS) as [
                      ProjectPlatform,
                      string,
                    ][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePlatform(key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                        formPlatforms.includes(key)
                          ? "bg-indigo-500/10 text-indigo-500 border-indigo-500/30"
                          : "bg-card text-muted-foreground border-input hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  URL
                </label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  Repo URL
                </label>
                <input
                  type="url"
                  value={formRepoUrl}
                  onChange={(e) => setFormRepoUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  className="mt-1 w-full px-3 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (mode === "edit") {
                      onModeChange("view");
                    } else {
                      handleClose();
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium rounded-lg border bg-card text-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!formName.trim() || isPending}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending
                    ? mode === "create"
                      ? "Creating..."
                      : "Saving..."
                    : mode === "create"
                      ? "Create Project"
                      : "Save Changes"}
                </button>
              </div>
            </form>
          </>
        ) : project ? (
          <>
            {/* Hero header */}
            <div className="relative overflow-hidden rounded-t-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-cyan-500/5" />
              <div className="relative px-6 pt-6 pb-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/10 to-cyan-500/10 flex items-center justify-center flex-shrink-0">
                    <NatureIcon
                      nature={project.nature}
                      className="w-6 h-6 text-indigo-500"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogHeader className="p-0">
                      <DialogTitle className="text-lg leading-snug">
                        {project.name}
                      </DialogTitle>
                      <DialogDescription className="sr-only">
                        Project details for {project.name}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${(project.status && STATUS_COLORS[project.status]) ?? "bg-muted text-muted-foreground"}`}
                      >
                        {(project.status && STATUS_LABELS[project.status]) ??
                          project.status ??
                          "unknown"}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                        {NATURE_LABELS[project.nature] ?? project.nature}
                      </span>
                      {project.isEndorsed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-500">
                          <svg
                            className="w-3 h-3"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Endorsed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* Description */}
              {project.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {project.description}
                </p>
              )}

              {/* Link cards */}
              {(project.url || project.repoUrl) && (
                <div className="flex flex-wrap gap-2">
                  {project.url && (
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card text-sm text-foreground hover:bg-accent/50 transition-colors group"
                    >
                      <svg
                        className="w-4 h-4 text-muted-foreground group-hover:text-indigo-500 transition-colors"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                        />
                      </svg>
                      <span className="truncate max-w-[180px]">
                        {project.url.replace(/^https?:\/\/(www\.)?/, "")}
                      </span>
                      <svg
                        className="w-3 h-3 text-muted-foreground flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </a>
                  )}
                  {project.repoUrl && (
                    <a
                      href={project.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card text-sm text-foreground hover:bg-accent/50 transition-colors group"
                    >
                      <svg
                        className="w-4 h-4 text-muted-foreground group-hover:text-indigo-500 transition-colors"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                      </svg>
                      <span className="truncate max-w-[180px]">
                        {project.repoUrl
                          .replace(/^https?:\/\/(www\.)?github\.com\//, "")
                          .replace(/^https?:\/\//, "")}
                      </span>
                      <svg
                        className="w-3 h-3 text-muted-foreground flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </a>
                  )}
                </div>
              )}

              {/* Platforms */}
              {project.platforms && project.platforms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {project.platforms.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center px-2.5 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground"
                    >
                      {PLATFORM_LABELS[p] ?? p}
                    </span>
                  ))}
                </div>
              )}

              {/* Divider */}
              <div className="border-t" />

              {/* Members */}
              <ProjectMembersSection
                projectId={project.id}
                members={project.members}
                canManage={canManage}
              />

              {/* Footer with metadata + actions */}
              <div className="flex items-center justify-between pt-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Created{" "}
                  {new Date(project.createdAt).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                {canManage && (
                  <div className="flex items-center gap-2">
                    {confirmDelete ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Delete?
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate()}
                          disabled={deleteMutation.isPending}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {deleteMutation.isPending ? "..." : "Yes"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md border text-foreground hover:bg-accent transition-colors"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete project"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={startEditing}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border text-foreground hover:bg-accent transition-colors"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            />
                          </svg>
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProjectMembersSection({
  projectId,
  members,
  canManage,
}: {
  projectId: string;
  members: Array<{
    id: string;
    name: string;
    image?: string | null;
    role: string;
  }>;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"owner" | "contributor">(
    "contributor",
  );

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.v1
        .projects({ id: projectId })
        .members.post({ userId: addUserId, role: addRole });
      if (res.error) throw new Error("Failed to add member");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setAddUserId("");
      setShowAddForm(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await api.api.v1
        .projects({ id: projectId })
        .members({ userId })
        .delete();
      if (res.error) throw new Error("Failed to remove member");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Team ({members.length})
        </h4>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showAddForm ? "rotate-45" : ""}`}
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
            {showAddForm ? "Cancel" : "Add"}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={member.name} image={member.image} size="sm" />
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground truncate block">
                  {member.name}
                </span>
              </div>
              <span
                className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  member.role === "owner"
                    ? "bg-indigo-500/10 text-indigo-500"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {member.role}
              </span>
            </div>
            {canManage && !(member.role === "owner" && ownerCount <= 1) && (
              <button
                type="button"
                onClick={() => removeMutation.mutate(member.id)}
                disabled={removeMutation.isPending}
                className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                title={`Remove ${member.name}`}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && showAddForm && (
        <MemberAutocomplete
          existingMemberIds={members.map((m) => m.id)}
          role={addRole}
          onRoleChange={setAddRole}
          onSelect={(userId) => {
            setAddUserId(userId);
          }}
          selectedUserId={addUserId}
          onAdd={() => addMutation.mutate()}
          isPending={addMutation.isPending}
        />
      )}
    </div>
  );
}

function MemberAutocomplete({
  existingMemberIds,
  role,
  onRoleChange,
  onSelect,
  selectedUserId,
  onAdd,
  isPending,
}: {
  existingMemberIds: string[];
  role: "owner" | "contributor";
  onRoleChange: (role: "owner" | "contributor") => void;
  onSelect: (userId: string) => void;
  selectedUserId: string;
  onAdd: () => void;
  isPending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const { data: suggestions } = useQuery({
    queryKey: ["members-search", debouncedSearch],
    queryFn: async () => {
      const res = await api.api.v1.members.get({
        query: { page: 1, limit: 10, ...(debouncedSearch ? { q: debouncedSearch } : {}) },
      });
      if (res.error) throw new Error("Failed to search members");
      return res.data;
    },
    enabled: open && debouncedSearch.length > 0,
  });

  const filteredMembers = (suggestions?.members ?? []).filter(
    (m: { userId: string }) => !existingMemberIds.includes(m.userId),
  );

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1" ref={containerRef}>
          <input
            type="text"
            placeholder="Search members..."
            value={selectedName || search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedName("");
              onSelect("");
              setOpen(true);
            }}
            onFocus={() => {
              if (search.length > 0 && !selectedUserId) setOpen(true);
            }}
            className="w-full px-2.5 py-1.5 text-xs bg-card border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
          />
          {open && filteredMembers.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg overflow-hidden max-h-40 overflow-y-auto">
              {filteredMembers.map(
                (m: {
                  userId: string;
                  user: { name: string; image?: string | null };
                }) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => {
                      onSelect(m.userId);
                      setSelectedName(m.user.name);
                      setSearch("");
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/50 transition-colors"
                  >
                    <Avatar
                      name={m.user.name}
                      image={m.user.image}
                      size="sm"
                    />
                    <span className="text-xs font-medium text-foreground truncate">
                      {m.user.name}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
          {open && debouncedSearch.length > 0 && filteredMembers.length === 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg px-2.5 py-2">
              <span className="text-xs text-muted-foreground">
                No members found
              </span>
            </div>
          )}
        </div>
        <select
          value={role}
          onChange={(e) =>
            onRoleChange(e.target.value as "owner" | "contributor")
          }
          className="px-2 py-1.5 text-xs bg-card border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground"
        >
          <option value="contributor">Contributor</option>
          <option value="owner">Owner</option>
        </select>
        <button
          type="button"
          onClick={onAdd}
          disabled={!selectedUserId || isPending}
          className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "..." : "Add"}
        </button>
      </div>
    </div>
  );
}

function Avatar({
  name,
  image,
  size = "sm",
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "lg";
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const sizeClass =
    size === "lg" ? "w-14 h-14 text-lg" : "w-7 h-7 text-[10px]";

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br from-indigo-400 to-cyan-400 flex items-center justify-center flex-shrink-0`}
    >
      <span className="text-white font-semibold">{initials}</span>
    </div>
  );
}
