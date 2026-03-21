import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api } from "../../../lib/api-client";

export const Route = createFileRoute("/_authenticated/dashboard/search")({
  component: SearchPage,
});

type SearchType = "all" | "messages" | "memories";

const TYPE_OPTIONS: { value: SearchType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "messages", label: "Messages" },
  { value: "memories", label: "Memories" },
];

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-500/10 text-blue-500",
  fact: "bg-green-500/10 text-green-500",
  opinion: "bg-amber-500/10 text-amber-500",
  skill: "bg-purple-500/10 text-purple-500",
  relationship: "bg-pink-500/10 text-pink-500",
  event: "bg-cyan-500/10 text-cyan-500",
};

function SearchPage() {
  const [input, setInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [type, setType] = useState<SearchType>("all");

  useEffect(() => {
    if (!input.trim()) {
      setDebouncedQuery("");
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(input.trim()), 400);
    return () => clearTimeout(timer);
  }, [input]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", debouncedQuery, type],
    queryFn: async () => {
      const res = await api.api.v1.search.get({
        query: { q: debouncedQuery, type, limit: 20 },
      });
      if (res.error) throw new Error("Failed to search");
      return res.data;
    },
    enabled: debouncedQuery.length > 0,
  });

  const messages = data?.messages ?? [];
  const memories = data?.memories ?? [];
  const hasResults = messages.length > 0 || memories.length > 0;
  const showLoading = isLoading && debouncedQuery.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search chat history and community knowledge
        </p>
      </div>

      {/* Search input & type filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-lg flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search messages and memories..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-colors text-foreground placeholder:text-muted-foreground"
          />
          {isFetching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Type segmented buttons */}
        <div className="flex rounded-lg border border-input overflow-hidden">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                type === opt.value
                  ? "bg-indigo-600 text-white"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {!debouncedQuery ? (
        <EmptyState
          title="Enter a query to search"
          description="Search across group chat messages and extracted community memories."
        />
      ) : showLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Searching...</span>
          </div>
        </div>
      ) : !hasResults ? (
        <EmptyState
          title="No results found"
          description="Try a different query or broaden your search type."
        />
      ) : (
        <div className="space-y-6">
          {/* Messages section */}
          {messages.length > 0 && (type === "all" || type === "messages") && (
            <section>
              {type === "all" && (
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Messages ({messages.length})
                </h2>
              )}
              <div className="space-y-2">
                {messages.map((msg) => (
                  <MessageCard key={msg.messageId} message={msg} />
                ))}
              </div>
            </section>
          )}

          {/* Memories section */}
          {memories.length > 0 && (type === "all" || type === "memories") && (
            <section>
              {type === "all" && (
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Memories ({memories.length})
                </h2>
              )}
              <div className="space-y-2">
                {memories.map((mem) => (
                  <MemoryCard key={mem.id} memory={mem} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MessageCard({
  message,
}: {
  message: {
    messageId: number;
    text: string | null;
    caption: string | null;
    fromFirstName: string | null;
    fromUsername: string | null;
    date: string | Date;
    score: number;
  };
}) {
  const content = message.text || message.caption || "";
  const truncated =
    content.length > 200 ? `${content.slice(0, 200)}...` : content;
  const author = [
    message.fromFirstName,
    message.fromUsername ? `@${message.fromUsername}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const date = new Date(message.date).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="bg-card rounded-lg border p-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground leading-relaxed flex-1">
          {truncated}
        </p>
        <RelevanceBadge score={message.score} label="relevance" />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        {author && <span className="font-medium">{author}</span>}
        <span>{date}</span>
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
}: {
  memory: {
    id: string;
    content: string;
    category: string;
    subject: string | null;
    similarity: number;
    createdAt: string | Date;
  };
}) {
  const date = new Date(memory.createdAt).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const colorClass =
    CATEGORY_COLORS[memory.category] ?? "bg-muted text-muted-foreground";

  return (
    <div className="bg-card rounded-lg border p-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground leading-relaxed flex-1">
          {memory.content}
        </p>
        <RelevanceBadge score={memory.similarity} label="similarity" />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${colorClass}`}
        >
          {memory.category}
        </span>
        {memory.subject && (
          <span className="font-medium">{memory.subject}</span>
        )}
        <span>{date}</span>
      </div>
    </div>
  );
}

function RelevanceBadge({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const pct = Math.round(score * 100);
  return (
    <span
      className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-500"
      title={`${label}: ${pct}%`}
    >
      {pct}%
    </span>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
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
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607Z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          {description}
        </p>
      </div>
    </div>
  );
}
