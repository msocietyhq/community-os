import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../lib/api-client";
import { PublicHeader } from "../../components/public-header";

export const Route = createFileRoute("/member/$username")({
  component: MemberProfilePage,
});

const NATURE_LABELS: Record<string, string> = {
  community: "Community",
  startup: "Startup",
  side_project: "Side Project",
};

const NATURE_COLORS: Record<string, string> = {
  community: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  startup: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  side_project: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

function MemberProfilePage() {
  const { username } = Route.useParams();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const fromSameOrigin =
      !!document.referrer &&
      new URL(document.referrer).origin === window.location.origin;
    setCanGoBack(fromSameOrigin);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["member", username],
    queryFn: async () => {
      const res = await api.api.v1.members.username({ username }).get();
      if (res.error) throw new Error("Failed to fetch member");
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

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-40 pb-24">
        {/* Back link */}
        {canGoBack ? (
          <button
            type="button"
            onClick={() => window.history.back()}
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
            Back
          </button>
        ) : (
          <Link
            to="/projects"
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
        )}

        {isLoading ? (
          <div className="space-y-6">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-full bg-white/5 animate-pulse" />
              <div className="space-y-2">
                <div className="h-8 w-48 rounded-lg bg-white/5 animate-pulse" />
                <div className="h-5 w-32 rounded-lg bg-white/5 animate-pulse" />
              </div>
            </div>
            <div className="h-20 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-40 rounded-xl bg-white/5 animate-pulse" />
          </div>
        ) : error || !data || "message" in data ? (
          <div className="text-center py-20">
            <h2 className="text-2xl font-semibold mb-2">Member not found</h2>
            <p className="text-gray-400">
              This member may not exist or hasn't set up their profile yet.
            </p>
          </div>
        ) : (
          <MemberContent member={data} />
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

type MemberData = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.v1.members.username>["get"]>>["data"]
>;

function MemberContent({ member }: { member: Exclude<MemberData, { message: string }> }) {
  const { user, projects } = member;

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="space-y-8">
      {/* Profile header */}
      <div className="flex items-center gap-5">
        {user.image ? (
          <img
            src={user.image}
            alt={user.name}
            className="w-20 h-20 rounded-full object-cover"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/30 to-indigo-500/30 flex items-center justify-center">
            <span className="text-xl font-medium text-white/70">{initials}</span>
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{user.name}</h1>
          {(member.currentTitle || member.currentCompany) && (
            <p className="text-gray-400 mt-1">
              {member.currentTitle}
              {member.currentTitle && member.currentCompany && " at "}
              {member.currentCompany}
            </p>
          )}
          {user.telegramUsername && (
            <a
              href={`https://t.me/${user.telegramUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors mt-1 inline-block"
            >
              @{user.telegramUsername}
            </a>
          )}
        </div>
      </div>

      {/* Bio */}
      {member.bio && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            About
          </h2>
          <p className="text-gray-300 leading-relaxed">{member.bio}</p>
        </div>
      )}

      {/* Skills */}
      {member.skills && member.skills.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Skills
          </h2>
          <div className="flex flex-wrap gap-2">
            {member.skills.map((skill) => (
              <span
                key={skill}
                className="text-sm px-3 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 text-blue-400"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Interests */}
      {member.interests && member.interests.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Interests
          </h2>
          <div className="flex flex-wrap gap-2">
            {member.interests.map((interest) => (
              <span
                key={interest}
                className="text-sm px-3 py-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-400"
              >
                {interest}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* External links */}
      {(member.githubHandle || member.linkedinUrl || member.websiteUrl) && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Links
          </h2>
          <div className="flex flex-wrap gap-3">
            {member.githubHandle && (
              <a
                href={`https://github.com/${member.githubHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-blue-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </a>
            )}
            {member.linkedinUrl && (
              <a
                href={member.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-blue-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                LinkedIn
              </a>
            )}
            {member.websiteUrl && (
              <a
                href={member.websiteUrl}
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
          </div>
        </div>
      )}

      {/* Projects */}
      {projects && projects.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Projects
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {projects.map((project) => (
              <Link
                key={project.id}
                to="/projects/$slug"
                params={{ slug: project.slug }}
                className="p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors space-y-3"
              >
                <h3 className="text-sm font-semibold text-white">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="text-xs text-gray-500 line-clamp-2">
                    {project.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                      NATURE_COLORS[project.nature] ??
                      "bg-white/5 text-gray-300 border-white/10"
                    }`}
                  >
                    {NATURE_LABELS[project.nature] ?? project.nature}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
