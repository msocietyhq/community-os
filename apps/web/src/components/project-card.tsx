import { Link } from "@tanstack/react-router";
import type { api } from "../lib/api-client";

export type Project = NonNullable<
  Awaited<ReturnType<typeof api.api.v1.projects.get>>["data"]
>["projects"][number];

export const PLATFORM_LABELS: Record<string, string> = {
  web_app: "Web App",
  mobile_app: "Mobile App",
  mobile_game: "Mobile Game",
  telegram_bot: "Telegram Bot",
  library: "Library",
  other: "Other",
};

const NATURE_HOVER_STYLES = {
  community: {
    glow: "from-blue-600/20 via-indigo-600/20 to-cyan-500/20",
    text: "group-hover:from-blue-400 group-hover:to-cyan-400",
    line: "via-blue-500/50",
  },
  startup: {
    glow: "from-emerald-600/20 via-green-600/20 to-teal-500/20",
    text: "group-hover:from-emerald-400 group-hover:to-teal-400",
    line: "via-emerald-500/50",
  },
  side_project: {
    glow: "from-rose-600/20 via-red-600/20 to-orange-500/20",
    text: "group-hover:from-rose-400 group-hover:to-orange-400",
    line: "via-rose-500/50",
  },
};

function MemberAvatars({
  members,
  totalCount,
}: {
  members: { id: string; name: string; image: string | null }[];
  totalCount: number;
}) {
  if (totalCount === 0) return null;

  const showOverflow = totalCount > 3;
  const visible = showOverflow ? members.slice(0, 2) : members;
  const remaining = totalCount - visible.length;

  return (
    <div className="flex -space-x-2 flex-shrink-0">
      {visible.map((member) => (
        <div
          key={member.id}
          className="w-7 h-7 rounded-full ring-2 ring-gray-950 overflow-hidden bg-gradient-to-br from-blue-500/30 to-indigo-500/30 flex items-center justify-center"
          title={member.name}
        >
          {member.image ? (
            <img
              src={member.image}
              alt={member.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[10px] font-medium text-white/70">
              {member.name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
          )}
        </div>
      ))}
      {showOverflow && remaining > 0 && (
        <div className="w-7 h-7 rounded-full ring-2 ring-gray-950 bg-white/10 flex items-center justify-center">
          <span className="text-[10px] font-medium text-white/70">
            +{remaining}
          </span>
        </div>
      )}
    </div>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const styles =
    NATURE_HOVER_STYLES[
      project.nature as keyof typeof NATURE_HOVER_STYLES
    ] ?? NATURE_HOVER_STYLES.community;

  return (
    <Link to="/projects/$slug" params={{ slug: project.slug }}>
      <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.05] shadow-xl hover:shadow-2xl transition-all duration-500 overflow-hidden h-full flex flex-col">
        {/* Gradient glow on hover */}
        <div
          className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br ${styles.glow} blur-xl -z-10`}
        />
        {/* Shine sweep */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

        <div className="relative p-6 flex flex-col flex-1">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3
              className={`font-bold text-lg leading-tight text-white group-hover:text-transparent group-hover:bg-gradient-to-r ${styles.text} group-hover:bg-clip-text transition-all duration-300`}
            >
              {project.name}
            </h3>
            <MemberAvatars
              members={project.members}
              totalCount={project.memberCount}
            />
          </div>

          {project.description && (
            <p className="text-gray-400 text-sm leading-relaxed mb-4 flex-1 line-clamp-3">
              {project.description}
            </p>
          )}

          {project.platforms && project.platforms.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-auto">
              {project.platforms.map((p) => (
                <span
                  key={p}
                  className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-gray-400"
                >
                  {PLATFORM_LABELS[p] ?? p}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom gradient line */}
        <div
          className={`h-[2px] bg-gradient-to-r from-transparent ${styles.line} to-transparent transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500`}
        />
      </div>
    </Link>
  );
}
