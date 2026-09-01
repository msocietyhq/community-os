import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { PublicHeader } from "../../components/public-header";
import { ProjectCard } from "../../components/project-card";
import { z } from "zod";

type Nature = "community" | "startup" | "side_project";

const projectSearchSchema = z.object({
  search: z.string().optional().catch(undefined),
  nature: z
    .enum(["community", "startup", "side_project"])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/projects/")({
  component: PublicProjectsPage,
  validateSearch: projectSearchSchema,
});

const NATURE_OPTIONS = [
  {
    value: "",
    label: "All",
    active: "bg-white/15 text-white border-white/20",
    hover: "hover:bg-white/10 hover:text-gray-200",
  },
  {
    value: "community",
    label: "Community",
    active: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    hover: "hover:bg-blue-500/10 hover:text-blue-400",
  },
  {
    value: "startup",
    label: "Startup",
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    hover: "hover:bg-emerald-500/10 hover:text-emerald-400",
  },
  {
    value: "side_project",
    label: "Side Project",
    active: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    hover: "hover:bg-rose-500/10 hover:text-rose-400",
  },
] as const;

function PublicProjectsPage() {
  const searchParams = Route.useSearch();
  const [search, setSearch] = useState(searchParams.search ?? "");
  const [nature, setNature] = useState<Nature | "">(searchParams.nature ?? "");

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.api.v1.projects.get({ query: { page: 1, limit: 100 } }),
  });

  const allProjects = data?.data?.projects ?? [];

  const projects = useMemo(() => {
    let filtered = allProjects;
    if (nature) {
      filtered = filtered.filter((p) => p.nature === nature);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [allProjects, search, nature]);

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

      {/* Page heading */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-40 pb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Projects
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Discover tech projects from MSOCIETY members — from community projects
          &amp; side projects to startups.
        </p>
      </section>

      {/* Filters */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50"
            />
          </div>

          {/* Nature filter */}
          <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
            {NATURE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setNature(option.value as Nature | "")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-r border-white/10 last:border-r-0 ${
                  nature === option.value
                    ? option.active
                    : `bg-white/5 text-gray-400 ${option.hover}`
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
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
          <p className="text-center text-gray-500 py-12">
            {search || nature
              ? "No projects match your filters."
              : "No projects yet."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
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
