import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
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
          to="/events"
        />
        <DashboardCard
          title="Projects"
          description="Browse community projects and showcase yours"
          to="/projects"
        />
        <DashboardCard
          title="Funds"
          description="Community fund tracking and transparency"
          to="/funds"
        />
      </div>
    </div>
  );
}

function DashboardCard({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="block p-6 bg-white rounded-lg border border-gray-200 hover:shadow-md transition-shadow"
    >
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-600">{description}</p>
    </Link>
  );
}
