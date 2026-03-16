import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/funds")({
  component: FundsPage,
});

function FundsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Funds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Community fund tracking and transparency.
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
                d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-foreground">Coming soon</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">
            Fund tracking and financial transparency reports will be available
            here.
          </p>
        </div>
      </div>
    </div>
  );
}
