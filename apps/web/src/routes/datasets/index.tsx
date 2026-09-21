import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { PublicHeader } from "../../components/public-header";

type Dataset = NonNullable<
  Awaited<ReturnType<typeof api.api.datasets.get>>["data"]
>[number];

type Category = Dataset["category"];

const CATEGORY_META: Record<
  Category,
  {
    label: string;
    badge: string;
    glow: string;
    line: string;
    active: string;
    hover: string;
  }
> = {
  religious_infrastructure: {
    label: "Religious infrastructure",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    glow: "from-emerald-600/20 via-teal-600/20 to-cyan-500/20",
    line: "via-emerald-500/50",
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    hover: "hover:bg-emerald-500/10 hover:text-emerald-400",
  },
  community_data: {
    label: "Community data",
    badge: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    glow: "from-blue-600/20 via-indigo-600/20 to-cyan-500/20",
    line: "via-blue-500/50",
    active: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    hover: "hover:bg-blue-500/10 hover:text-blue-400",
  },
  educational: {
    label: "Educational",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    glow: "from-amber-600/20 via-orange-600/20 to-yellow-500/20",
    line: "via-amber-500/50",
    active: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    hover: "hover:bg-amber-500/10 hover:text-amber-400",
  },
  health_wellness: {
    label: "Health & wellness",
    badge: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    glow: "from-rose-600/20 via-red-600/20 to-orange-500/20",
    line: "via-rose-500/50",
    active: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    hover: "hover:bg-rose-500/10 hover:text-rose-400",
  },
  business_economy: {
    label: "Business & economy",
    badge: "border-purple-500/20 bg-purple-500/10 text-purple-300",
    glow: "from-purple-600/20 via-violet-600/20 to-fuchsia-500/20",
    line: "via-purple-500/50",
    active: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    hover: "hover:bg-purple-500/10 hover:text-purple-400",
  },
  other: {
    label: "Other",
    badge: "border-white/10 bg-white/5 text-gray-300",
    glow: "from-gray-600/20 via-slate-600/20 to-gray-500/20",
    line: "via-gray-400/50",
    active: "bg-white/15 text-white border-white/20",
    hover: "hover:bg-white/10 hover:text-gray-200",
  },
};

const CATEGORY_ORDER = Object.keys(CATEGORY_META) as Category[];

/** Falls back to a neutral style for a category value the frontend doesn't
 * know about yet (e.g. a new enum value added on the API before this app is
 * redeployed), showing the raw value instead of silently dropping it. */
function categoryMeta(category: string): (typeof CATEGORY_META)[Category] {
  const known = (
    CATEGORY_META as Record<
      string,
      (typeof CATEGORY_META)[Category] | undefined
    >
  )[category];
  return known ?? { ...CATEGORY_META.other, label: category };
}

/** Known categories first (in CATEGORY_ORDER), then any unrecognized ones. */
function orderCategories(categories: Iterable<string>): string[] {
  const set = new Set(categories);
  const known = CATEGORY_ORDER.filter((c) => set.has(c));
  const unknown = [...set]
    .filter((c) => !(CATEGORY_ORDER as string[]).includes(c))
    .sort();
  return [...known, ...unknown];
}

export const Route = createFileRoute("/datasets/")({
  component: DatasetsPage,
  head: () => ({
    meta: [
      { title: "SG Muslim Datasets | MSOCIETY" },
      {
        name: "description",
        content: "Discover open datasets for Singapore's Muslim community.",
      },
    ],
  }),
});

function DatasetsPage() {
  const [category, setCategory] = useState<string>("");

  const query = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      const r = await api.api.datasets.get();
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });

  const allDatasets = query.data ?? [];
  const datasets = useMemo(
    () =>
      category
        ? allDatasets.filter((d) => d.category === category)
        : allDatasets,
    [allDatasets, category],
  );

  const grouped = useMemo(
    () =>
      datasets.reduce<Record<string, Dataset[]>>((g, d) => {
        const bucket = g[d.category] ?? [];
        bucket.push(d);
        g[d.category] = bucket;
        return g;
      }, {}),
    [datasets],
  );

  const groupedEntries = orderCategories(Object.keys(grouped)).map(
    (c) => [c, grouped[c] ?? []] as const,
  );

  const presentCategories = useMemo(
    () => orderCategories(allDatasets.map((d) => d.category)),
    [allDatasets],
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-hidden">
      {/* Animated gradient orbs */}
      <div
        className="fixed top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-1 20s ease-in-out infinite" }}
      />
      <div
        className="fixed top-1/2 right-1/4 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-2 25s ease-in-out infinite" }}
      />
      <div
        className="fixed bottom-1/4 left-1/2 w-72 h-72 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"
        style={{ animation: "float-3 22s ease-in-out infinite" }}
      />

      <PublicHeader transparent />

      {/* Page heading */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-40 pb-12">
        <p className="text-sm uppercase tracking-widest text-cyan-400 mb-4">
          Open knowledge
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          SG Muslim Datasets
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl">
          Explore open data about Singapore's Muslim community. Share, reuse,
          and build with datasets curated by the community.
        </p>
      </section>

      {/* Filters */}
      {presentCategories.length > 1 && (
        <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
          <div className="inline-flex flex-wrap rounded-lg border border-white/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setCategory("")}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-r border-b border-white/10 last:border-r-0 whitespace-nowrap ${
                category === ""
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              }`}
            >
              All
            </button>
            {presentCategories.map((c) => {
              const meta = categoryMeta(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors border-r border-b border-white/10 last:border-r-0 whitespace-nowrap ${
                    category === c
                      ? meta.active
                      : `bg-white/5 text-gray-400 ${meta.hover}`
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {query.isLoading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-56 rounded-2xl border border-white/10 bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : query.isError ? (
          <StateCard
            tone="error"
            title="Unable to load datasets right now."
            description="Something went wrong while fetching the dataset directory. Please try again in a moment."
          />
        ) : datasets.length === 0 ? (
          <StateCard
            tone="empty"
            title={
              category
                ? "No datasets in this category."
                : "No datasets published yet."
            }
            description={
              category
                ? "Try a different category or view all datasets."
                : "Check back soon — new datasets are added as the community curates them."
            }
            action={
              category
                ? { label: "View all datasets", onClick: () => setCategory("") }
                : undefined
            }
          />
        ) : (
          <div className="space-y-14">
            {groupedEntries.map(([c, items]) => (
              <section key={c}>
                {!category && (
                  <h2 className="mb-5 text-2xl font-semibold">
                    {categoryMeta(c).label}
                  </h2>
                )}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((d) => (
                    <DatasetCard key={d.id} dataset={d} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

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

function DatasetCard({ dataset }: { dataset: Dataset }) {
  const meta = categoryMeta(dataset.category);

  return (
    <div className="group relative rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.05] shadow-xl hover:shadow-2xl transition-all duration-500 overflow-hidden h-full flex flex-col">
      {/* Gradient glow on hover */}
      <div
        className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br ${meta.glow} blur-xl -z-10`}
      />

      <div className="relative p-6 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-3 mb-3">
          <span
            className={`w-fit whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${meta.badge}`}
          >
            {meta.label}
          </span>
          {dataset.license && (
            <span className="flex-shrink-0 text-xs text-gray-500 text-right">
              {dataset.license}
            </span>
          )}
        </div>

        <h3 className="text-xl font-semibold text-white leading-tight">
          {dataset.title}
        </h3>
        <p className="mt-3 mb-4 flex-1 text-sm leading-6 text-gray-400 line-clamp-3">
          {dataset.description}
        </p>

        {dataset.formats.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {[...new Set(dataset.formats)].map((f) => (
              <span
                key={f}
                className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-gray-400"
              >
                {f}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 mb-5">
          {dataset.coverage && (
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
                  d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                />
              </svg>
              {dataset.coverage}
            </span>
          )}
          {dataset.lastUpdated && (
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
              Updated {new Date(dataset.lastUpdated).toLocaleDateString()}
            </span>
          )}
        </div>

        <a
          href={dataset.link}
          target="_blank"
          rel="noreferrer"
          className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-center text-sm font-medium text-gray-950 hover:bg-cyan-400 transition-colors"
        >
          View dataset
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 6H21m0 0v7.5M21 6l-9 9-4.5-4.5L3 15"
            />
          </svg>
        </a>
      </div>

      {/* Bottom gradient line */}
      <div
        className={`h-[2px] bg-gradient-to-r from-transparent ${meta.line} to-transparent transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500`}
      />
    </div>
  );
}

function StateCard({
  tone,
  title,
  description,
  action,
}: {
  tone: "empty" | "error";
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="relative rounded-2xl border border-white/5 bg-white/[0.02] p-12 sm:p-16 text-center overflow-hidden">
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full blur-[80px] pointer-events-none ${
          tone === "error" ? "bg-rose-600/10" : "bg-cyan-600/10"
        }`}
      />

      <div className="relative">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
          <svg
            className={`w-8 h-8 ${tone === "error" ? "text-rose-400" : "text-gray-500"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            {tone === "error" ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
              />
            )}
          </svg>
        </div>

        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">{description}</p>

        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium text-gray-300 hover:text-white transition-all"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
