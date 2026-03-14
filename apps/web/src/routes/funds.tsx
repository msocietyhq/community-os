import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/funds")({
  component: FundsPage,
});

function FundsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Funds</h1>
      <p className="text-gray-600">
        Community fund tracking and transparency.
      </p>
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        Fund tracking coming soon.
      </div>
    </div>
  );
}
