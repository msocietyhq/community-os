import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { PublicHeader } from "../../components/public-header";
import { z } from "zod";

const eventSearchSchema = z.object({
  type: z
    .enum(["meetup", "workshop", "hackathon", "talk", "social", "other"])
    .optional()
    .catch(undefined),
  filter: z.enum(["upcoming", "past"]).optional().catch(undefined),
});

export const Route = createFileRoute("/events/")({
  component: PublicEventsPage,
  validateSearch: eventSearchSchema,
});

type EventType =
  | "meetup"
  | "workshop"
  | "hackathon"
  | "talk"
  | "social"
  | "other";

const TYPE_OPTIONS = [
  {
    value: "",
    label: "All",
    active: "bg-white/15 text-white border-white/20",
    hover: "hover:bg-white/10 hover:text-gray-200",
  },
  {
    value: "meetup",
    label: "Meetup",
    active: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    hover: "hover:bg-blue-500/10 hover:text-blue-400",
  },
  {
    value: "workshop",
    label: "Workshop",
    active: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    hover: "hover:bg-amber-500/10 hover:text-amber-400",
  },
  {
    value: "hackathon",
    label: "Hackathon",
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    hover: "hover:bg-emerald-500/10 hover:text-emerald-400",
  },
  {
    value: "talk",
    label: "Talk",
    active: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    hover: "hover:bg-purple-500/10 hover:text-purple-400",
  },
  {
    value: "social",
    label: "Social",
    active: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    hover: "hover:bg-rose-500/10 hover:text-rose-400",
  },
] as const;

const TYPE_LABELS: Record<string, string> = {
  meetup: "Meetup",
  workshop: "Workshop",
  hackathon: "Hackathon",
  talk: "Talk",
  social: "Social",
  other: "Other",
};

const TYPE_COLORS: Record<string, string> = {
  meetup: "text-blue-400",
  workshop: "text-amber-400",
  hackathon: "text-emerald-400",
  talk: "text-purple-400",
  social: "text-rose-400",
  other: "text-gray-400",
};

type Event = NonNullable<
  Awaited<ReturnType<typeof api.api.v1.events.get>>["data"]
>["events"][number];

function PublicEventsPage() {
  const searchParams = Route.useSearch();
  const [eventType, setEventType] = useState<EventType | "">(
    searchParams.type ?? "",
  );
  const [timeFilter, setTimeFilter] = useState<"upcoming" | "past">(
    searchParams.filter ?? "upcoming",
  );

  const now = new Date().toISOString();

  const { data, isLoading } = useQuery({
    queryKey: ["events", timeFilter],
    queryFn: () =>
      api.api.v1.events.get({
        query: {
          status: "published",
          page: 1,
          limit: 100,
          ...(timeFilter === "upcoming"
            ? { startsAfter: now }
            : { startsBefore: now }),
        },
      }),
  });

  const allEvents = data?.data?.events ?? [];

  const events = eventType
    ? allEvents.filter((e) => e.eventType === eventType)
    : allEvents;

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-hidden">
      {/* Animated gradient orbs */}
      <div
        className="fixed top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-1 20s ease-in-out infinite" }}
      />
      <div
        className="fixed top-1/2 right-1/4 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-2 25s ease-in-out infinite" }}
      />
      <div
        className="fixed bottom-1/4 left-1/2 w-72 h-72 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-3 22s ease-in-out infinite" }}
      />

      <PublicHeader transparent />

      {/* Page heading */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-40 pb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Events
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Meetups, workshops, hackathons, and more from the MSOCIETY community.
        </p>
      </section>

      {/* Filters */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Time filter */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTimeFilter("upcoming")}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                timeFilter === "upcoming"
                  ? "bg-white/15 text-white border-white/20"
                  : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              }`}
            >
              Upcoming
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter("past")}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                timeFilter === "past"
                  ? "bg-white/15 text-white border-white/20"
                  : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              }`}
            >
              Past
            </button>
          </div>

          {/* Type filter */}
          <div className="flex gap-2 overflow-x-auto">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setEventType(option.value as EventType | "")}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border whitespace-nowrap ${
                  eventType === option.value
                    ? option.active
                    : `border-white/10 bg-white/5 text-gray-400 ${option.hover}`
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Events list */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyEvents
            message={
              eventType
                ? "No events match your filters."
                : timeFilter === "upcoming"
                  ? "No upcoming events scheduled yet."
                  : "No past events found."
            }
            isFiltered={!!eventType}
            onClearFilter={() => setEventType("")}
          />
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                isPast={timeFilter === "past"}
              />
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-gray-500 text-sm">
            &copy; {new Date().getFullYear()} MSOCIETY. Built by the community,
            for the community.
          </p>
        </div>
      </footer>
    </div>
  );
}

function EventCard({
  event,
  isPast,
}: {
  event: Event;
  isPast: boolean;
}) {
  const date = new Date(event.startsAt);
  const endDate = event.endsAt ? new Date(event.endsAt) : null;

  const day = date.getDate();
  const month = date.toLocaleDateString("en-SG", { month: "short" });
  const weekday = date.toLocaleDateString("en-SG", { weekday: "short" });
  const time = date.toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = endDate
    ? endDate.toLocaleTimeString("en-SG", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={`group relative rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-300 overflow-hidden ${
        isPast ? "opacity-60 hover:opacity-80" : ""
      }`}
    >
      {/* Hover glow */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-blue-600/10 via-indigo-600/10 to-cyan-500/10 blur-xl -z-10" />

      <div className="relative p-6 flex gap-6">
        {/* Date badge */}
        <div className="hidden sm:flex flex-col items-center justify-center w-16 flex-shrink-0">
          <span className="text-xs font-medium text-gray-500 uppercase">
            {weekday}
          </span>
          <span className="text-3xl font-bold text-white leading-none mt-1">
            {day}
          </span>
          <span className="text-xs font-medium text-gray-500 uppercase mt-1">
            {month}
          </span>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px bg-white/10 self-stretch" />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-bold text-lg text-white group-hover:text-blue-400 transition-colors leading-tight">
              {event.title}
            </h3>
            <span
              className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border border-white/10 bg-white/5 ${TYPE_COLORS[event.eventType] ?? "text-gray-400"}`}
            >
              {TYPE_LABELS[event.eventType] ?? event.eventType}
            </span>
          </div>

          {event.description && (
            <p className="text-gray-400 text-sm leading-relaxed mb-3 line-clamp-2">
              {event.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
            {/* Time */}
            <span className="inline-flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              {time}
              {endTime && ` - ${endTime}`}
            </span>

            {/* Location */}
            <span className="inline-flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                {event.isOnline ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                  />
                )}
              </svg>
              {event.isOnline ? "Online" : "In-person"}
            </span>

            {/* Capacity */}
            {event.maxAttendees && (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
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

            {/* Mobile date */}
            <span className="inline-flex items-center gap-1.5 sm:hidden">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                />
              </svg>
              {weekday}, {day} {month}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyEvents({
  message,
  isFiltered,
  onClearFilter,
}: {
  message: string;
  isFiltered: boolean;
  onClearFilter: () => void;
}) {
  return (
    <div className="relative rounded-2xl border border-white/5 bg-white/[0.02] p-12 sm:p-16 text-center overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-indigo-600/10 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative">
        {/* Calendar icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
          <svg
            className="w-8 h-8 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
            />
          </svg>
        </div>

        <h3 className="text-lg font-semibold text-white mb-2">{message}</h3>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          {isFiltered
            ? "Try adjusting your filters to find what you're looking for."
            : "Stay tuned — new events are announced regularly in the community."}
        </p>

        {isFiltered && (
          <button
            type="button"
            onClick={onClearFilter}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium text-gray-300 hover:text-white transition-all"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
