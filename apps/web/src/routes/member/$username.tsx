import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, apiBase } from "../../lib/api-client";
import { resetMetaToDefaults, setMetaTag } from "../../lib/meta";
import { PublicHeader } from "../../components/public-header";
import { useAuth } from "../../lib/auth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";

/**
 * The primitives are styled for the themed dashboard (`bg-card`, `border-input`).
 * This page is a fixed dark surface, so inputs get an explicit override —
 * `cn` merges via tailwind-merge, so these win over the defaults.
 */
const DARK_FIELD =
  "bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-white/25 focus:ring-white/10";

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
  const { user } = useAuth();
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

  useEffect(() => {
    if (!data || "message" in data) return;

    const name = data.user.name;
    const title = `${name} — MSOCIETY`;
    const fallbackDesc =
      [data.currentTitle, data.currentCompany].filter(Boolean).join(" · ") ||
      `${name}'s projects on MSOCIETY`;
    const description = data.bio ?? fallbackDesc;
    const ogImage = `${apiBase}/api/v1/members/username/${username}/og-image`;
    const pageUrl = `${window.location.origin}/member/${username}`;

    document.title = title;
    setMetaTag("description", description);
    setMetaTag("og:title", title, "property");
    setMetaTag("og:description", description, "property");
    setMetaTag("og:image", ogImage, "property");
    setMetaTag("og:url", pageUrl, "property");
    setMetaTag("og:type", "profile", "property");
    setMetaTag("twitter:card", "summary_large_image");
    setMetaTag("twitter:title", title);
    setMetaTag("twitter:description", description);
    setMetaTag("twitter:image", ogImage);

    return () => {
      resetMetaToDefaults();
    };
  }, [data, username]);

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
          <MemberContent
            member={data}
            username={username}
            isOwner={!!user && user.id === data.userId}
          />
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

type PublicMember = Exclude<MemberData, { message: string }>;

function MemberContent({
  member,
  username,
  isOwner,
}: {
  member: PublicMember;
  username: string;
  isOwner: boolean;
}) {
  const { user, projects } = member;
  const [isEditing, setIsEditing] = useState(false);

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="space-y-8">
      {/* Profile header — identity stays put; only the body switches to a form */}
      <div className="flex items-start gap-5">
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
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{user.name}</h1>
          {!isEditing && (member.currentTitle || member.currentCompany) && (
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
        {isOwner && !isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white shrink-0"
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
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
              />
            </svg>
            Edit profile
          </Button>
        )}
      </div>

      {isEditing ? (
        <MemberEditForm
          member={member}
          username={username}
          onDone={() => setIsEditing(false)}
        />
      ) : (
        <MemberDisplay member={member} projects={projects} />
      )}
    </div>
  );
}

function MemberDisplay({
  member,
  projects,
}: {
  member: PublicMember;
  projects: PublicMember["projects"];
}) {
  return (
    <div className="space-y-8">

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

/** A suggestion the API has already filtered and keyed. Keys are opaque. */
interface SuggestionEntry {
  field: string;
  display: string;
  values: string[];
  keys: string[];
}

function parseCsvList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function EditField({
  id,
  label,
  hint,
  footer,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-gray-400">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-gray-600">{hint}</p>}
      {footer}
    </div>
  );
}

function SuggestionCard({
  entry,
  onUse,
  onDismiss,
  isDismissing,
}: {
  entry: SuggestionEntry;
  onUse: () => void;
  onDismiss: () => void;
  isDismissing: boolean;
}) {
  return (
    <div className="mt-2 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-300">
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
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
          />
        </svg>
        Suggested
      </div>
      <p className="mt-1 text-sm text-gray-200">{entry.display}</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onDismiss}
          disabled={isDismissing}
          className="border-white/10 bg-transparent text-gray-400 hover:bg-white/5 hover:text-white"
        >
          Dismiss
        </Button>
        <Button size="sm" onClick={onUse}>
          Use
        </Button>
      </div>
    </div>
  );
}

/**
 * The profile page in edit mode.
 *
 * Suggestions come from `GET /me` already filtered and keyed — the browser
 * never decides what to show or derives a dismissal key. `Use` only fills the
 * input; the member still presses Save, so an accepted suggestion is always an
 * edit they made.
 */
function MemberEditForm({
  member,
  username,
  onDone,
}: {
  member: PublicMember;
  username: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();

  const [bio, setBio] = useState(member.bio ?? "");
  const [title, setTitle] = useState(member.currentTitle ?? "");
  const [company, setCompany] = useState(member.currentCompany ?? "");
  const [education, setEducation] = useState(member.education ?? "");
  const [skills, setSkills] = useState(member.skills?.join(", ") ?? "");
  const [interests, setInterests] = useState(member.interests?.join(", ") ?? "");
  const [github, setGithub] = useState(member.githubHandle ?? "");
  const [linkedin, setLinkedin] = useState(member.linkedinUrl ?? "");
  const [website, setWebsite] = useState(member.websiteUrl ?? "");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await api.api.v1.members.me.get();
      if (res.error) throw new Error("Failed to fetch profile");
      return res.data;
    },
  });

  const suggestions: SuggestionEntry[] = me?.suggestions ?? [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.v1.members.me.patch({
        bio: bio || undefined,
        currentTitle: title || undefined,
        currentCompany: company || undefined,
        education: education || undefined,
        skills: skills ? parseCsvList(skills) : undefined,
        interests: interests ? parseCsvList(interests) : undefined,
        githubHandle: github || undefined,
        linkedinUrl: linkedin || undefined,
        websiteUrl: website || undefined,
      });
      if (res.error) throw new Error("Failed to save profile");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", username] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      onDone();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (keys: string[]) => {
      const res = await api.api.v1.members.me["dismiss-suggestions"].post({
        keys,
      });
      if (res.error) throw new Error("Failed to dismiss suggestion");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const suggestionFor = (field: string, apply: (values: string[]) => void) => {
    const entry = suggestions.find((s) => s.field === field);
    if (!entry) return null;
    return (
      <SuggestionCard
        entry={entry}
        onUse={() => apply(entry.values)}
        onDismiss={() => dismissMutation.mutate(entry.keys)}
        isDismissing={dismissMutation.isPending}
      />
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate();
      }}
      className="space-y-6"
    >
      <EditField
        id="bio"
        label="About"
        hint={`${bio.length}/500`}
        footer={suggestionFor("bio", (v) => setBio(v[0] ?? ""))}
      >
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="What do you work on?"
          className={DARK_FIELD}
        />
      </EditField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EditField
          id="title"
          label="Role"
          footer={suggestionFor("currentTitle", (v) => setTitle(v[0] ?? ""))}
        >
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Software Engineer"
            className={DARK_FIELD}
          />
        </EditField>
        <EditField
          id="company"
          label="Company"
          footer={suggestionFor("currentCompany", (v) => setCompany(v[0] ?? ""))}
        >
          <Input
            id="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Grab"
            className={DARK_FIELD}
          />
        </EditField>
      </div>

      <EditField
        id="education"
        label="Education"
        footer={suggestionFor("education", (v) => setEducation(v[0] ?? ""))}
      >
        <Input
          id="education"
          value={education}
          onChange={(e) => setEducation(e.target.value)}
          placeholder="NUS, Computer Science"
          className={DARK_FIELD}
        />
      </EditField>

      <EditField
        id="skills"
        label="Skills"
        hint="Comma-separated."
        footer={suggestionFor("skills", (v) =>
          setSkills([...parseCsvList(skills), ...v].join(", ")),
        )}
      >
        <Input
          id="skills"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="TypeScript, React, Postgres"
          className={DARK_FIELD}
        />
      </EditField>

      <EditField
        id="interests"
        label="Interests"
        hint="Comma-separated."
        footer={suggestionFor("interests", (v) =>
          setInterests([...parseCsvList(interests), ...v].join(", ")),
        )}
      >
        <Input
          id="interests"
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="AI, Open Source, Web Dev"
          className={DARK_FIELD}
        />
      </EditField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EditField id="github" label="GitHub">
          <Input
            id="github"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="username"
            className={DARK_FIELD}
          />
        </EditField>
        <EditField id="linkedin" label="LinkedIn">
          <Input
            id="linkedin"
            type="url"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/in/..."
            className={DARK_FIELD}
          />
        </EditField>
      </div>

      <EditField id="website" label="Website">
        <Input
          id="website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://..."
          className={DARK_FIELD}
        />
      </EditField>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/5">
        {saveMutation.isError && (
          <span className="text-sm text-red-400">
            Could not save. Try again.
          </span>
        )}
        <Button
          variant="outline"
          onClick={onDone}
          disabled={saveMutation.isPending}
          className="border-white/10 bg-transparent text-gray-400 hover:bg-white/5 hover:text-white"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
