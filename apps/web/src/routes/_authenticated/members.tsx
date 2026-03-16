import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api-client";

export const Route = createFileRoute("/_authenticated/members")({
  component: MembersPage,
});

function MembersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
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

  const members = data?.members ?? [];
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
                <MemberRow key={member.id} member={member} />
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
    </div>
  );
}

function MemberRow({
  member,
}: {
  member: {
    id: string;
    userId: string;
    bio?: string | null;
    skills?: string[] | null;
    currentTitle?: string | null;
    currentCompany?: string | null;
    joinedAt?: string | Date | null;
    user: {
      name: string;
      image?: string | null;
      role?: string | null;
      banned?: boolean | null;
      telegramUsername?: string | null;
    };
  };
}) {
  const initials = member.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const joinedDate = member.joinedAt
    ? new Date(member.joinedAt).toLocaleDateString("en-SG", {
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 sm:gap-4 px-6 py-4 items-center hover:bg-accent/50 transition-colors">
      {/* Member info */}
      <div className="flex items-center gap-3">
        {member.user.image ? (
          <img
            src={member.user.image}
            alt={member.user.name}
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-cyan-400 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-semibold">
              {initials}
            </span>
          </div>
        )}
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
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            member.user.role === "admin"
              ? "bg-indigo-500/10 text-indigo-500"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {member.user.role ?? "member"}
        </span>
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
    </div>
  );
}
