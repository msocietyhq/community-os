import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/infra")({
  component: InfraPage,
});

function InfraPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Infrastructure</h1>
      <p className="text-gray-600">
        Manage infrastructure resources for endorsed projects.
      </p>
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        Infrastructure management coming soon.
      </div>
    </div>
  );
}
