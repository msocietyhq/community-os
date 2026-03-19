import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useAuth } from "../lib/auth";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { user, isLoading } = useAuth();

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

      {/* Floating dashboard button */}
      {!isLoading && user && (
        <Link
          to="/dashboard"
          className="fixed top-4 right-4 z-50 text-sm bg-white text-gray-900 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors backdrop-blur-md shadow-lg"
        >
          Dashboard
        </Link>
      )}

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 text-center">
        <div className="inline-block mb-6 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-gray-300">
          Muslim Tech Professionals
        </div>
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
          <span className="block text-white">MSOCIETY</span>
          <span className="gradient-text">Build. Connect. Grow.</span>
        </h1>
        <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          A community of Muslim tech professionals in Singapore building
          together, learning from each other, and making an impact.
        </p>
      </section>

      {/* Features */}
      <section
        id="features"
        className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            title="Events"
            description="Meetups, workshops, and hackathons for the community."
            icon={
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                />
              </svg>
            }
          />
          <FeatureCard
            title="Projects"
            description="Collaborate on open-source projects and showcase your work."
            icon={
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
                />
              </svg>
            }
          />
          <FeatureCard
            title="Community"
            description="Connect with fellow Muslim tech professionals in Singapore."
            icon={
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
                />
              </svg>
            }
          />
        </div>
      </section>

      {/* Projects Showcase */}
      <ProjectsShowcase />

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

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-6 rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center mb-4 text-blue-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

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

function ProjectsShowcase() {
  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.api.v1.projects.get({ query: { page: 1, limit: 20 } }),
  });

  const projects = data?.data?.projects ?? [];

  if (isLoading) {
    return (
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <h2 className="text-3xl font-bold text-center mb-4">Projects</h2>
        <p className="text-gray-400 text-center mb-12">
          Discover tech projects from MSOCIETY members.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 rounded-xl border border-white/10 bg-white/5 animate-pulse"
            />
          ))}
        </div>
      </section>
    );
  }

  if (projects.length === 0) return null;

  const grouped = Object.groupBy(projects, (p) => p.nature);
  const categoryOrder = ["community", "startup", "side_project"] as const;

  return (
    <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
      <h2 className="text-3xl font-bold text-center mb-4">Projects</h2>
      <p className="text-gray-400 text-center mb-12">
        Discover tech projects from MSOCIETY members — from community projects
        &amp; side projects to startups.
      </p>

      {categoryOrder.map((nature) => {
        const items = grouped[nature];
        if (!items?.length) return null;
        return (
          <div key={nature} className="mb-12 last:mb-0">
            <h3 className="text-xl font-semibold mb-6 text-gray-200">
              {NATURE_LABELS[nature] ?? nature}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

type Project = NonNullable<
  Awaited<ReturnType<typeof api.api.v1.projects.get>>["data"]
>["projects"][number];

function ProjectCard({ project }: { project: Project }) {
  const content = (
    <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.05] shadow-xl hover:shadow-2xl transition-all duration-500 overflow-hidden h-full flex flex-col">
      {/* Gradient glow on hover */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-blue-600/20 via-indigo-600/20 to-cyan-500/20 blur-xl -z-10" />
      {/* Shine sweep */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

      <div className="relative p-6 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h4 className="font-bold text-xl leading-tight text-white group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-cyan-400 group-hover:bg-clip-text transition-all duration-300">
            {project.name}
          </h4>
          {(project as any).members?.length > 0 && (
            <div className="flex -space-x-2 flex-shrink-0">
              {((project as any).members as string[]).slice(0, (project as any).members.length > 3 ? 2 : 3).map((initials: string, i: number) => (
                <div
                  key={i}
                  className="relative z-0 hover:z-10 transition-all duration-300 rounded-full ring-2 ring-white/10 hover:ring-blue-400/50 hover:scale-110 hover:shadow-lg hover:shadow-blue-500/30 w-8 h-8 bg-gradient-to-br from-blue-500/30 to-indigo-500/30 flex items-center justify-center text-[10px] font-medium text-white/70"
                >
                  {initials}
                </div>
              ))}
              {(project as any).members.length > 3 && (
                <div className="relative z-0 hover:z-10 transition-all duration-300 rounded-full ring-2 ring-white/10 hover:ring-blue-400/50 hover:scale-110 hover:shadow-lg hover:shadow-blue-500/30 w-8 h-8 bg-white/10 flex items-center justify-center text-[10px] font-medium text-white/70">
                  +{(project as any).members.length - 2}
                </div>
              )}
            </div>
          )}
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

      {/* Bottom gradient line */}
      <div className="h-[2px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
    </div>
  );

  return (
    <Link to="/projects/$slug" params={{ slug: project.slug }}>
      {content}
    </Link>
  );
}
