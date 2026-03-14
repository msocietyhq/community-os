import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
      </div>
      <p className="text-gray-600">
        Community projects built by MSOCIETY members.
      </p>
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        No projects yet. Check back soon!
      </div>
    </div>
  );
}
