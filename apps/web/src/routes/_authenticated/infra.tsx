import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/infra")({
  component: InfraPage,
});

function InfraPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Infrastructure
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage infrastructure resources for endorsed projects.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
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
                d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-foreground">Coming soon</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">
            Infrastructure provisioning and monitoring for community projects
            will be available here.
          </p>
        </div>
      </div>
    </div>
  );
}
