import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api-client";

export const Route = createFileRoute("/_authenticated/events")({
  component: EventsPage,
});

type StatusFilter = "upcoming" | "past" | "all";

const EVENT_TYPE_LABELS: Record<string, string> = {
  meetup: "Meetup",
  workshop: "Workshop",
  hackathon: "Hackathon",
  talk: "Talk",
  social: "Social",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-500",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/10 text-red-500",
  completed: "bg-indigo-500/10 text-indigo-500",
};

function EventsPage() {
  const [filter, setFilter] = useState<StatusFilter>("upcoming");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["events", filter, page],
    queryFn: async () => {
      const now = new Date().toISOString();
      const query = {
        page,
        limit,
        ...(filter === "upcoming" ? { startsAfter: now } : {}),
        ...(filter === "past" ? { startsBefore: now } : {}),
      };
      const res = await api.api.v1.events.get({ query });
      if (res.error) throw new Error("Failed to fetch events");
      return res.data;
    },
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total > 0
              ? `${total} event${total === 1 ? "" : "s"}`
              : "Browse community events."}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {(["upcoming", "past", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
              filter === f
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Events list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="bg-card rounded-xl border shadow-sm flex items-center justify-center py-16">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">
                Loading events...
              </span>
            </div>
          </div>
        ) : events.length === 0 ? (
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
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                  />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-foreground">
                No {filter === "all" ? "" : `${filter} `}events
              </h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                {filter === "upcoming"
                  ? "No upcoming events scheduled. Check back soon!"
                  : filter === "past"
                    ? "No past events found."
                    : "No events found."}
              </p>
            </div>
          </div>
        ) : (
          events.map((event) => <EventCard key={event.id} event={event} />)
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

function EventCard({
  event,
}: {
  event: {
    id: string;
    title: string;
    description?: string | null;
    eventType: string;
    status: string | null;
    isOnline?: boolean | null;
    startsAt: string | Date;
    endsAt?: string | Date | null;
    maxAttendees?: number | null;
  };
}) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;

  const dateStr = start.toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const timeStr = start.toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const endTimeStr = end
    ? end.toLocaleTimeString("en-SG", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const isPast = start < new Date();

  return (
    <div
      className={`bg-card rounded-xl border shadow-sm p-5 transition-colors hover:bg-accent/30 ${isPast ? "opacity-70" : ""}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Date badge */}
        <div className="flex-shrink-0 w-14 h-14 rounded-lg bg-muted flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-foreground leading-none">
            {start.getDate()}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            {start.toLocaleDateString("en-SG", { month: "short" })}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {event.title}
            </h3>
            <span
              className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${(event.status && STATUS_COLORS[event.status]) ?? "bg-muted text-muted-foreground"}`}
            >
              {(event.status && STATUS_LABELS[event.status]) ?? event.status ?? "unknown"}
            </span>
          </div>

          {event.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {event.description}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {/* Time */}
            <span className="flex items-center gap-1">
              <svg
                className="w-3.5 h-3.5"
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
              {dateStr}, {timeStr}
              {endTimeStr && ` – ${endTimeStr}`}
            </span>

            {/* Type */}
            <span className="flex items-center gap-1">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 6h.008v.008H6V6Z"
                />
              </svg>
              {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
            </span>

            {/* Location */}
            <span className="flex items-center gap-1">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                />
              </svg>
              {event.isOnline ? "Online" : "In-person"}
            </span>

            {/* Capacity */}
            {event.maxAttendees && (
              <span className="flex items-center gap-1">
                <svg
                  className="w-3.5 h-3.5"
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
                Max {event.maxAttendees}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
