import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { useAuth } from "../../lib/auth";

export const Route = createFileRoute("/projects/")({
  component: PublicProjectsPage,
});

const NATURE_LABELS: Record<string, string> = {
  community: "Community Projects",
  startup: "Startups",
  side_project: "Side Projects",
};

const PLATFORM_LABELS: Record<string, string> = {
  web_app: "Web App",
  mobile_app: "Mobile App",
  mobile_game: "Mobile Game",
  telegram_bot: "Telegram Bot",
  library: "Library",
  other: "Other",
};

type Project = NonNullable<
  Awaited<ReturnType<typeof api.api.v1.projects.get>>["data"]
>["projects"][number];

function PublicProjectsPage() {
  const { user, isLoading: authLoading } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.api.v1.projects.get({ query: { page: 1, limit: 50 } }),
  });

  const projects = data?.data?.projects ?? [];
  const grouped = Object.groupBy(projects, (p) => p.nature);
  const categoryOrder = ["community", "startup", "side_project"] as const;

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

      {/* Header */}
      <header className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-3 text-white hover:text-gray-300 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">
            MSOCIETY
          </span>
        </Link>
        {!authLoading && user && (
          <Link
            to="/dashboard"
            className="text-sm bg-white text-gray-900 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Dashboard
          </Link>
        )}
      </header>

      {/* Page heading */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Projects
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Discover tech projects from MSOCIETY members — from community projects
          &amp; side projects to startups.
        </p>
      </section>

      {/* Projects grid */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-48 rounded-xl border border-white/10 bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="text-center text-gray-500">No projects yet.</p>
        ) : (
          categoryOrder.map((nature) => {
            const items = grouped[nature];
            if (!items?.length) return null;
            return (
              <div key={nature} className="mb-12 last:mb-0">
                <h2 className="text-xl font-semibold mb-6 text-gray-200">
                  {NATURE_LABELS[nature] ?? nature}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

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

function ProjectCard({ project }: { project: Project }) {
  const content = (
    <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.05] shadow-xl hover:shadow-2xl transition-all duration-500 overflow-hidden h-full flex flex-col">
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-blue-600/20 via-indigo-600/20 to-cyan-500/20 blur-xl -z-10" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

      <div className="relative p-6 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-bold text-xl leading-tight text-white group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-cyan-400 group-hover:bg-clip-text transition-all duration-300">
            {project.name}
          </h3>
          {(() => {
            const members = (project as Project & { members?: string[] }).members;
            if (!members?.length) return null;
            return (
              <div className="flex -space-x-2 flex-shrink-0">
                {members
                  .slice(0, members.length > 3 ? 2 : 3)
                  .map((initials, i) => (
                    <div
                      key={i}
                      className="relative z-0 hover:z-10 transition-all duration-300 rounded-full ring-2 ring-white/10 hover:ring-blue-400/50 hover:scale-110 hover:shadow-lg hover:shadow-blue-500/30 w-8 h-8 bg-gradient-to-br from-blue-500/30 to-indigo-500/30 flex items-center justify-center text-[10px] font-medium text-white/70"
                    >
                      {initials}
                    </div>
                  ))}
                {members.length > 3 && (
                  <div className="relative z-0 hover:z-10 transition-all duration-300 rounded-full ring-2 ring-white/10 hover:ring-blue-400/50 hover:scale-110 hover:shadow-lg hover:shadow-blue-500/30 w-8 h-8 bg-white/10 flex items-center justify-center text-[10px] font-medium text-white/70">
                    +{members.length - 2}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        {project.description && (
          <p className="text-gray-400 text-sm leading-relaxed mb-4 flex-1">
            {project.description}
          </p>
        )}
        {project.platforms && project.platforms.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-auto">
            {project.platforms.map((p) => (
              <span
                key={p}
                className="text-xs px-2 py-1 rounded-full border border-white/10 bg-white/5 text-gray-300"
              >
                {PLATFORM_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="h-[2px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
    </div>
  );

  return (
    <Link to="/projects/$slug" params={{ slug: project.slug }}>
      {content}
    </Link>
  );
}
