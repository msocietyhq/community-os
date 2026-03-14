import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/events")({
  component: EventsPage,
});

function EventsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
      </div>
      <p className="text-gray-600">
        Browse and RSVP to upcoming community events.
      </p>
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        No events yet. Check back soon!
      </div>
    </div>
  );
}
