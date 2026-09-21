import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { PublicHeader } from "../../components/public-header";
type Dataset = NonNullable<
  Awaited<ReturnType<typeof api.api.datasets.get>>["data"]
>[number];
const LABELS: Record<string, string> = {
  religious_infrastructure: "Religious infrastructure",
  community_data: "Community data",
  educational: "Educational",
  health_wellness: "Health & wellness",
  business_economy: "Business & economy",
  other: "Other",
};
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
  const query = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      const r = await api.api.datasets.get();
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const grouped = (query.data ?? []).reduce<Record<string, Dataset[]>>(
    (g, d) => {
      const category = g[d.category] ?? [];
      category.push(d);
      g[d.category] = category;
      return g;
    },
    {},
  );
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PublicHeader transparent />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-36">
        <header className="mb-14">
          <p className="text-sm uppercase tracking-widest text-cyan-400">
            Open knowledge
          </p>
          <h1 className="my-4 text-5xl font-bold">SG Muslim Datasets</h1>
          <p className="max-w-2xl text-lg text-gray-400">
            Explore open data about Singapore’s Muslim community. Share, reuse,
            and build with datasets curated by the community.
          </p>
        </header>
        {query.isLoading ? (
          <p>Loading datasets…</p>
        ) : query.isError ? (
          <p className="text-red-300">Unable to load datasets right now.</p>
        ) : (
          <div className="space-y-12">
            {Object.entries(grouped).map(([category, items]) => (
              <section key={category}>
                <h2 className="mb-5 text-2xl font-semibold">
                  {LABELS[category] ?? category}
                </h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((d) => (
                    <article
                      key={d.id}
                      className="flex flex-col rounded-2xl border border-white/10 bg-white/[.04] p-6"
                    >
                      <span className="w-fit rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-300">
                        {LABELS[d.category]}
                      </span>
                      <h3 className="mt-4 text-xl font-semibold">{d.title}</h3>
                      <p className="my-4 flex-1 text-sm leading-6 text-gray-400">
                        {d.description}
                      </p>
                      <div className="space-y-2 text-xs text-gray-400">
                        <p>
                          <b className="text-gray-200">Formats:</b>{" "}
                          {d.formats.join(", ")}
                        </p>
                        <p>
                          <b className="text-gray-200">Coverage:</b>{" "}
                          {d.coverage ?? "—"}
                        </p>
                        <p>
                          <b className="text-gray-200">Updated:</b>{" "}
                          {d.lastUpdated
                            ? new Date(d.lastUpdated).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                      <a
                        href={d.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-5 rounded-lg bg-cyan-500 px-4 py-2 text-center text-sm font-medium text-gray-950"
                      >
                        View dataset
                      </a>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
