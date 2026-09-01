import { useMemo, useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { PublicHeader } from "../components/public-header";
import { ProjectCard } from "../components/project-card";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-hidden">
      {/* Animated gradient orbs */}
      <div
        className="fixed top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none"
        style={{ animation: "float-1 20s ease-in-out infinite" }}
      />
      <div
        className="fixed top-1/2 right-1/4 w-[400px] h-[400px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none"
        style={{ animation: "float-2 25s ease-in-out infinite" }}
      />
      <div
        className="fixed bottom-1/4 left-1/2 w-[350px] h-[350px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none"
        style={{ animation: "float-3 22s ease-in-out infinite" }}
      />

      <PublicHeader transparent />
      <HeroSection />
      <FeaturesSection />
      <ProjectsShowcase />
      <MembershipGrowth />
      <Footer />
    </div>
  );
}

/* ─── Navbar ─────────────────────────────────────────────────── */

/* ─── Hero ───────────────────────────────────────────────────── */

function HeroSection() {
  return (
    <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-36 sm:pt-44 pb-24 text-center">
      <div className="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-gray-300">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        Muslim Tech Professionals in Singapore
      </div>

      <h1 className="text-5xl sm:text-6xl lg:text-8xl font-bold tracking-tight mb-8 leading-[0.95]">
        <span className="block text-white mb-2">Build.</span>
        <span className="block gradient-text">Connect. Grow.</span>
      </h1>

      <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-12 leading-relaxed">
        A community where Muslim tech professionals come together to build
        projects, share knowledge, and grow their careers.
      </p>
    </section>
  );
}

/* ─── Features ───────────────────────────────────────────────── */

const FEATURES = [
  {
    title: "Events",
    description:
      "Meetups, workshops, and hackathons designed to bring the community together and spark new ideas.",
    icon: (
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
    ),
    accent: "from-blue-500/20 to-cyan-500/20",
    iconColor: "text-blue-400",
  },
  {
    title: "Projects",
    description:
      "Collaborate on open-source projects, showcase your work, and find co-builders for your next idea.",
    icon: (
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
    ),
    accent: "from-indigo-500/20 to-purple-500/20",
    iconColor: "text-indigo-400",
  },
  {
    title: "Community",
    description:
      "Connect with fellow Muslim tech professionals in Singapore through our Telegram group and events.",
    icon: (
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
    ),
    accent: "from-emerald-500/20 to-teal-500/20",
    iconColor: "text-emerald-400",
  },
];

function FeaturesSection() {
  return (
    <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="group relative p-8 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-500"
          >
            {/* Hover glow */}
            <div
              className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br ${feature.accent} blur-xl -z-10`}
            />

            <div
              className={`w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 ${feature.iconColor} group-hover:scale-110 transition-transform duration-300`}
            >
              {feature.icon}
            </div>
            <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Projects Showcase ──────────────────────────────────────── */

function ProjectsShowcase() {
  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.api.v1.projects.get({ query: { page: 1, limit: 100 } }),
  });

  const allProjects = data?.data?.projects ?? [];

  const randomProjects = useMemo(() => {
    const shuffled = [...allProjects].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  }, [allProjects]);

  if (isLoading) {
    return (
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Community <span className="gradient-text">Projects</span>
          </h2>
          <p className="text-gray-400">
            Discover what MSOCIETY members are building.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-52 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse"
            />
          ))}
        </div>
      </section>
    );
  }

  if (allProjects.length === 0) return null;

  return (
    <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Community <span className="gradient-text">Projects</span>
        </h2>
        <p className="text-gray-400 max-w-xl mx-auto">
          From community initiatives and side projects to startups — see what
          members are building.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {randomProjects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>

      <Link to="/projects" className="group block mt-6">
        <div className="relative rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-500 p-8 sm:p-10 text-center overflow-hidden">
          {/* Hover glow */}
          <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-blue-600/10 via-indigo-600/10 to-cyan-500/10 blur-xl -z-10" />
          {/* Shine sweep */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

          <div className="relative">
            <h3 className="text-xl sm:text-2xl font-bold mb-2 text-white group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-cyan-400 group-hover:bg-clip-text transition-all duration-300">
              Explore all projects
            </h3>
            <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
              Browse community initiatives, side projects, and startups from
              MSOCIETY members.
            </p>
            <span className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-white/10 bg-white/5 group-hover:bg-white/10 text-sm font-medium text-gray-300 group-hover:text-white transition-all">
              View projects
              <svg
                className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                />
              </svg>
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}

/* ─── Membership Growth ──────────────────────────────────────── */

// Fixed chart geometry. Module-scoped so the memo hooks below can depend on
// these without a new object identity on every render.
const padding = { top: 60, right: 20, bottom: 40, left: 50 };
const width = 800;
const height = 340;
const chartW = width - padding.left - padding.right;
const chartH = height - padding.top - padding.bottom;

function MembershipGrowth() {
  const { data, isLoading } = useQuery({
    queryKey: ["membership-growth"],
    queryFn: () => api.api.v1.stats["membership-growth"].get(),
  });

  const points = (data?.data?.points ?? []) as {
    month: string;
    cumulative_members: number;
  }[];

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxVal = Math.max(...points.map((p) => p.cumulative_members), 1);
  const yMax = Math.ceil(maxVal / 50) * 50;

  const getX = useCallback(
    (i: number) => padding.left + (i / Math.max(points.length - 1, 1)) * chartW,
    [points.length],
  );
  const getY = useCallback(
    (val: number) => padding.top + chartH - (val / yMax) * chartH,
    [yMax],
  );

  const linePath = useMemo(() => {
    if (points.length === 0) return "";
    return points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.cumulative_members)}`,
      )
      .join(" ");
  }, [points, getX, getY]);

  const areaPath = useMemo(() => {
    if (points.length === 0) return "";
    const bottom = padding.top + chartH;
    return `${linePath} L ${getX(points.length - 1)} ${bottom} L ${getX(0)} ${bottom} Z`;
  }, [linePath, points.length, getX]);

  // Year labels for X axis
  const yearLabels = useMemo(() => {
    const labels: { x: number; label: string }[] = [];
    let lastYear = "";
    points.forEach((p, i) => {
      const year = p.month.split("-")[0] ?? "";
      if (year !== lastYear) {
        labels.push({ x: getX(i), label: year });
        lastYear = year;
      }
    });
    return labels;
  }, [points, getX]);

  // Y axis grid lines
  const yTicks = useMemo(() => {
    const step = yMax <= 100 ? 25 : yMax <= 300 ? 50 : 100;
    const ticks: number[] = [];
    for (let v = 0; v <= yMax; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [yMax]);

  if (isLoading) {
    return (
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32">
        <div className="h-[400px] rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse" />
      </section>
    );
  }

  if (points.length === 0) return null;

  const latest = points[points.length - 1]!;
  const firstYear = points[0]!.month.split("-")[0]!;
  const hovered = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Community <span className="gradient-text">Growth</span>
        </h2>
        <p className="text-gray-400 max-w-xl mx-auto">
          An invite-only community with organic growth since {firstYear},
          attracting {latest.cumulative_members.toLocaleString()}+ quality tech
          professionals across the region.
        </p>
      </div>

      <div className="relative rounded-2xl border border-white/5 bg-white/[0.02] p-6 sm:p-8 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Tooltip */}
        {hovered && (
          <div className="absolute top-6 right-6 sm:top-8 sm:right-8 text-right">
            <div className="text-2xl font-bold text-white">
              {hovered.cumulative_members.toLocaleString()} members
            </div>
            <div className="text-sm text-gray-400">
              {new Date(`${hovered.month}-01`).toLocaleDateString("en-SG", {
                month: "long",
                year: "numeric",
              })}
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="relative w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={padding.left}
                y1={getY(v)}
                x2={width - padding.right}
                y2={getY(v)}
                stroke="white"
                strokeOpacity="0.05"
              />
              <text
                x={padding.left - 10}
                y={getY(v) + 4}
                textAnchor="end"
                fill="white"
                fillOpacity="0.3"
                fontSize="11"
              >
                {v}
              </text>
            </g>
          ))}

          {/* Year labels */}
          {yearLabels.map((yl) => (
            <text
              key={yl.label}
              x={yl.x}
              y={height - 10}
              textAnchor="middle"
              fill="white"
              fillOpacity="0.3"
              fontSize="11"
            >
              {yl.label}
            </text>
          ))}

          {/* Area fill */}
          <path d={areaPath} fill="url(#areaGradient)" />

          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke="url(#lineGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover dot */}
          {hovered && hoveredIndex !== null && (
            <>
              <line
                x1={getX(hoveredIndex)}
                y1={padding.top}
                x2={getX(hoveredIndex)}
                y2={padding.top + chartH}
                stroke="white"
                strokeOpacity="0.1"
                strokeDasharray="4 4"
              />
              <circle
                cx={getX(hoveredIndex)}
                cy={getY(hovered.cumulative_members)}
                r="5"
                fill="#60a5fa"
                stroke="white"
                strokeWidth="2"
              />
            </>
          )}

          {/* Invisible hover zones */}
          {points.map((p, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only affordance over data the chart already renders visually
            <rect
              key={p.month}
              x={getX(i) - chartW / points.length / 2}
              y={padding.top}
              width={chartW / points.length}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(i)}
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <span className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()} MSOCIETY
          </span>

          <Link
            to="/projects"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Projects
          </Link>
        </div>
      </div>
    </footer>
  );
}
