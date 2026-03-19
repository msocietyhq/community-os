import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { PublicHeader } from "../../components/public-header";

export const Route = createFileRoute("/projects/$slug")({
  component: ProjectDetailPage,
});

const NATURE_LABELS: Record<string, string> = {
  community: "Community",
  startup: "Startup",
  side_project: "Side Project",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

const PLATFORM_LABELS: Record<string, string> = {
  web_app: "Web App",
  mobile_app: "Mobile App",
  mobile_game: "Mobile Game",
  telegram_bot: "Telegram Bot",
  library: "Library",
  other: "Other",
};

function ProjectDetailPage() {
  const { slug } = Route.useParams();


  const { data, isLoading, error } = useQuery({
    queryKey: ["project", slug],
    queryFn: async () => {
      const res = await api.api.v1.projects({ id: slug }).get();
      if (res.error) throw new Error("Failed to fetch project");
      return res.data;
    },
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-hidden">
      {/* Animated gradient orbs */}
      <div
        className="fixed top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-1 20s ease-in-out infinite" }}
      />
      <div
        className="fixed top-1/2 right-1/4 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-2 25s ease-in-out infinite" }}
      />
      <div
        className="fixed bottom-1/4 left-1/2 w-72 h-72 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-3 22s ease-in-out infinite" }}
      />

      <PublicHeader transparent />

      {/* Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-40 pb-24">
        {/* Back link */}
        <Link
          to="/projects"
          search={data?.nature ? { nature: data.nature } : {}}
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-8"
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
              d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
            />
          </svg>
          Back to Projects
        </Link>

        {isLoading ? (
          <div className="space-y-6">
            <div className="h-10 w-64 rounded-lg bg-white/5 animate-pulse" />
            <div className="h-6 w-full max-w-lg rounded-lg bg-white/5 animate-pulse" />
            <div className="h-40 rounded-xl bg-white/5 animate-pulse" />
          </div>
        ) : error || !data ? (
          <div className="text-center py-20">
            <h2 className="text-2xl font-semibold mb-2">Project not found</h2>
            <p className="text-gray-400">
              This project may have been removed or doesn't exist.
            </p>
          </div>
        ) : (
          <ProjectContent project={data} />
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-gray-500 text-sm">
            &copy; {new Date().getFullYear()} MSOCIETY. Built by the community,
            for the community.
          </p>
        </div>
      </footer>
    </div>
  );
}

type ProjectData = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.v1.projects>["get"]>>["data"]
>;

function ProjectContent({ project }: { project: ProjectData }) {
  const members = (
    project as ProjectData & {
      members?: Array<{
        id: string;
        name: string;
        image: string | null;
        role: string;
      }>;
    }
  ).members;

  return (
    <div className="space-y-8">
      {/* Title + badges */}
      <div>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {project.isEndorsed && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.745 3.745 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z"
                />
              </svg>
              Endorsed
            </span>
          )}
          <span className="text-xs font-medium px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-gray-300">
            {NATURE_LABELS[project.nature] ?? project.nature}
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-gray-300">
            {project.status ? (STATUS_LABELS[project.status] ?? project.status) : "Unknown"}
          </span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
          {project.name}
        </h1>

        {project.description && (
          <p className="text-lg text-gray-400 leading-relaxed">
            {project.description}
          </p>
        )}
      </div>

      {/* Platforms */}
      {project.platforms && project.platforms.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Platforms
          </h2>
          <div className="flex flex-wrap gap-2">
            {project.platforms.map((p) => (
              <span
                key={p}
                className="text-sm px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-gray-300"
              >
                {PLATFORM_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Links */}
      {(project.url || project.repoUrl) && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Links
          </h2>
          <div className="flex flex-wrap gap-3">
            {project.url && (
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-blue-400 transition-colors"
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
                    d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  />
                </svg>
                Website
              </a>
            )}
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-blue-400 transition-colors"
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
                    d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
                  />
                </svg>
                Repository
              </a>
            )}
          </div>
        </div>
      )}

      {/* Team members */}
      {members && members.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Team
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {members.map((member) => {
              const initials = member.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);
              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]"
                >
                  {member.image ? (
                    <img
                      src={member.image}
                      alt={member.name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/30 to-indigo-500/30 flex items-center justify-center">
                      <span className="text-xs font-medium text-white/70">
                        {initials}
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {member.name}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">
                      {member.role}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
