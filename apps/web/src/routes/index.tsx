import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">
        Welcome to MSOCIETY Hub
      </h1>
      <p className="text-lg text-gray-600">
        The community portal for Muslim tech professionals in Singapore.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <DashboardCard
          title="Events"
          description="View and RSVP to community events"
          href="/events"
        />
        <DashboardCard
          title="Projects"
          description="Browse community projects and showcase yours"
          href="/projects"
        />
        <DashboardCard
          title="Members"
          description="Connect with fellow community members"
          href="/members"
        />
      </div>
    </div>
  );
}

function DashboardCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block p-6 bg-white rounded-lg border border-gray-200 hover:shadow-md transition-shadow"
    >
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-600">{description}</p>
    </a>
  );
}
