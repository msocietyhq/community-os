import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";

export const Route = createFileRoute("/_authenticated/dashboard/members")({
  component: MembersPage,
});

interface Member {
  id: string;
  userId: string;
  bio?: string | null;
  githubHandle?: string | null;
  skills?: string[] | null;
  interests?: string[] | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  education?: string | null;
  linkedinUrl?: string | null;
  websiteUrl?: string | null;
  joinedAt?: string | Date | null;
  user: {
    name: string;
    image?: string | null;
    role?: string | null;
    banned?: boolean | null;
    telegramUsername?: string | null;
  };
}

function MembersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["members", search, page],
    queryFn: async () => {
      const res = await api.api.v1.members.get({
        query: {
          page,
          limit,
          ...(search ? { q: search } : {}),
        },
      });
      if (res.error) throw new Error("Failed to fetch members");
      return res.data;
    },
  });

  const members = (data?.members ?? []) as Member[];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total > 0
              ? `${total} member${total === 1 ? "" : "s"} in the community`
              : "Community members directory"}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search members..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Members list */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">
                Loading members...
              </span>
            </div>
          </div>
        ) : members.length === 0 ? (
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
                  d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground">
              {search ? "No members found" : "No members yet"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              {search
                ? "Try adjusting your search query."
                : "Members will appear here once they join the community."}
            </p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-muted border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Member</span>
              <span>Role</span>
              <span>Skills</span>
              <span className="text-right">Joined</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border">
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  onClick={() => setSelectedMember(member)}
                />
              ))}
            </div>
          </>
        )}
      </div>

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

      {/* Profile dialog */}
      <MemberProfileDialog
        member={selectedMember}
        open={selectedMember !== null}
        onClose={() => setSelectedMember(null)}
      />
    </div>
  );
}

function MemberRow({
  member,
  onClick,
}: {
  member: Member;
  onClick: () => void;
}) {
  const initials = getInitials(member.user.name);
  const joinedDate = formatJoinedDate(member.joinedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 sm:gap-4 px-6 py-4 items-center hover:bg-accent/50 transition-colors cursor-pointer"
    >
      {/* Member info */}
      <div className="flex items-center gap-3">
        <Avatar name={member.user.name} image={member.user.image} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {member.user.name}
          </p>
          {(member.currentTitle || member.currentCompany) && (
            <p className="text-xs text-muted-foreground truncate">
              {[member.currentTitle, member.currentCompany]
                .filter(Boolean)
                .join(" at ")}
            </p>
          )}
        </div>
      </div>

      {/* Role */}
      <div>
        <RoleBadge role={member.user.role} />
      </div>

      {/* Skills */}
      <div className="flex flex-wrap gap-1">
        {member.skills?.slice(0, 3).map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground"
          >
            {skill}
          </span>
        ))}
        {member.skills && member.skills.length > 3 && (
          <span className="text-xs text-muted-foreground">
            +{member.skills.length - 3}
          </span>
        )}
      </div>

      {/* Joined */}
      <div className="text-right">
        {joinedDate && (
          <span className="text-xs text-muted-foreground">{joinedDate}</span>
        )}
      </div>
    </button>
  );
}

function MemberProfileDialog({
  member,
  open,
  onClose,
}: {
  member: Member | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!member) return null;

  const joinedDate = member.joinedAt
    ? new Date(member.joinedAt).toLocaleDateString("en-SG", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const links = [
    member.user.telegramUsername && {
      label: "Telegram",
      href: `https://t.me/${member.user.telegramUsername}`,
      value: `@${member.user.telegramUsername}`,
    },
    member.githubHandle && {
      label: "GitHub",
      href: `https://github.com/${member.githubHandle}`,
      value: member.githubHandle,
    },
    member.linkedinUrl && {
      label: "LinkedIn",
      href: member.linkedinUrl,
      value: "Profile",
    },
    member.websiteUrl && {
      label: "Website",
      href: member.websiteUrl,
      value: member.websiteUrl.replace(/^https?:\/\//, ""),
    },
  ].filter(Boolean) as { label: string; href: string; value: string }[];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-4">
            <Avatar
              name={member.user.name}
              image={member.user.image}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <DialogTitle>{member.user.name}</DialogTitle>
              <DialogDescription>
                {[member.currentTitle, member.currentCompany]
                  .filter(Boolean)
                  .join(" at ") || "Community member"}
              </DialogDescription>
              <div className="mt-2">
                <RoleBadge role={member.user.role} />
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Bio */}
          {member.bio && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Bio
              </h4>
              <p className="text-sm text-foreground leading-relaxed">
                {member.bio}
              </p>
            </div>
          )}

          {/* Skills */}
          {member.skills && member.skills.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Skills
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {member.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center px-2.5 py-1 rounded-md bg-muted text-xs text-muted-foreground"
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
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Interests
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {member.interests.map((interest) => (
                  <span
                    key={interest}
                    className="inline-flex items-center px-2.5 py-1 rounded-md bg-indigo-500/10 text-xs text-indigo-500"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Education */}
          {member.education && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Education
              </h4>
              <p className="text-sm text-foreground">{member.education}</p>
            </div>
          )}

          {/* Links */}
          {links.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Links
              </h4>
              <div className="space-y-1.5">
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-indigo-500 hover:underline"
                  >
                    <span className="text-xs text-muted-foreground w-16 flex-shrink-0">
                      {link.label}
                    </span>
                    {link.value}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Joined */}
          {joinedDate && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Joined {joinedDate}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  const initials = getInitials(name);
  const sizeClass = size === "lg" ? "w-14 h-14 text-lg" : "w-9 h-9 text-xs";

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

function RoleBadge({ role }: { role?: string | null }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        role === "admin"
          ? "bg-indigo-500/10 text-indigo-500"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {role ?? "member"}
    </span>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatJoinedDate(date?: string | Date | null) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-SG", {
    month: "short",
    year: "numeric",
  });
}
