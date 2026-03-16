import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api-client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "there";

  const { data: membersData } = useQuery({
    queryKey: ["members", "count"],
    queryFn: async () => {
      const res = await api.api.v1.members.get({ query: { page: 1, limit: 1 } });
      if (res.error) throw new Error("Failed to fetch members");
      return res.data;
    },
  });

  const { data: eventsData } = useQuery({
    queryKey: ["events", "upcoming"],
    queryFn: async () => {
      const res = await api.api.v1.events.get({ query: { page: 1, limit: 1, startsAfter: new Date().toISOString(), status: "published" } });
      if (res.error) throw new Error("Failed to fetch events");
      return res.data;
    },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects", "count"],
    queryFn: async () => {
      const res = await api.api.v1.projects.get({ query: { page: 1, limit: 1 } });
      if (res.error) throw new Error("Failed to fetch projects");
      return res.data;
    },
  });

  const memberCount = membersData?.total ?? null;
  const upcomingEvents = eventsData?.total ?? null;
  const projectCount = projectsData?.total ?? null;

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here's what's happening in the MSOCIETY community.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Members" value={memberCount !== null ? String(memberCount) : "—"} />
        <StatCard label="Upcoming Events" value={upcomingEvents !== null ? String(upcomingEvents) : "—"} />
        <StatCard label="Active Projects" value={projectCount !== null ? String(projectCount) : "—"} />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick actions */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card rounded-xl border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h2 className="text-sm font-semibold text-card-foreground">
                Quick Actions
              </h2>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <QuickAction
                to="/events"
                title="Browse Events"
                description="View upcoming meetups and workshops"
                icon={
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                    />
                  </svg>
                }
              />
              <QuickAction
                to="/projects"
                title="Explore Projects"
                description="Discover community-built projects"
                icon={
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                    />
                  </svg>
                }
              />
              <QuickAction
                to="/members"
                title="View Members"
                description="Browse the community directory"
                icon={
                  <svg
                    className="w-5 h-5"
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
                }
              />
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="bg-card rounded-xl border shadow-sm">
          <div className="px-6 py-4 border-b">
            <h2 className="text-sm font-semibold text-card-foreground">
              Recent Activity
            </h2>
          </div>
          <div className="p-6">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg
                  className="w-5 h-5 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
              </div>
              <p className="text-sm text-muted-foreground">
                No recent activity
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Activity from the community will show up here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-xl border shadow-sm px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="mt-2">
        <span className="text-2xl font-semibold text-card-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}

function QuickAction({
  to,
  title,
  description,
  icon,
}: {
  to: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group relative flex items-start gap-4 p-4 rounded-lg border hover:bg-accent transition-all duration-300 overflow-hidden cursor-pointer"
    >
      <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-cyan-500/20 blur-sm -z-10" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none" />
      <div className="relative flex-shrink-0 w-10 h-10 rounded-lg bg-accent text-accent-foreground flex items-center justify-center group-hover:bg-accent/80 transition-colors">
        {icon}
      </div>
      <div className="relative min-w-0">
        <p className="text-sm font-medium text-foreground transition-colors">
          {title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </Link>
  );
}
