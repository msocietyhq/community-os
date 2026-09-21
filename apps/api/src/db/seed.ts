import { db } from "./index";
import { datasets, spendCategories, reputationTriggers } from "./schema";
import { DEFAULT_REPUTATION_TRIGGERS } from "@community-os/shared";

async function seed() {
  console.log("Seeding database...");

  // Seed spend categories
  await db
    .insert(spendCategories)
    .values([
      {
        name: "event",
        displayName: "Event Expenses",
        description: "Costs related to community events",
      },
      {
        name: "infra",
        displayName: "Infrastructure",
        description: "Cloud infrastructure and hosting costs",
      },
      {
        name: "misc",
        displayName: "Miscellaneous",
        description: "Other community expenses",
      },
    ])
    .onConflictDoNothing();

  // Seed reputation triggers
  await db
    .insert(reputationTriggers)
    .values(
      DEFAULT_REPUTATION_TRIGGERS.map((t) => ({
        triggerType: t.type,
        triggerValue: t.value,
        reputationValue: t.points,
      })),
    )
    .onConflictDoNothing();

  await db.insert(datasets).values([
    {
      title: "MUIS Datasets Unofficial",
      description:
        "A community-maintained collection of datasets and resources published by Singapore's Islamic Religious Council.",
      source: "MUIS / community-maintained",
      link: "https://github.com/msociety/muis-datasets",
      category: "religious_infrastructure",
      formats: ["CSV", "JSON"],
      license: "Open data (see source)",
      coverage: "Singapore",
      lastUpdated: new Date("2024-01-01"),
      tags: ["MUIS", "mosques", "Islamic institutions"],
      repoUrl: "https://github.com/msociety/muis-datasets",
    },
    {
      title: "Khutbah Database",
      description:
        "An archive of Singapore khutbah texts and themes for research, translation, and community education.",
      source: "MSOCIETY community",
      link: "https://github.com/msociety/khutbah-database",
      category: "religious_infrastructure",
      formats: ["JSON", "Markdown"],
      license: "CC BY 4.0",
      coverage: "Singapore; 2010–present",
      lastUpdated: new Date("2024-01-01"),
      tags: ["khutbah", "sermons", "Islamic education"],
      repoUrl: "https://github.com/msociety/khutbah-database",
    },
    {
      title: "Singapore Census Muslim Community Data",
      description:
        "Selected population and household indicators relevant to the Muslim community from Singapore census releases.",
      source: "Singapore Department of Statistics",
      link: "https://www.singstat.gov.sg/",
      category: "community_data",
      formats: ["CSV", "XLSX"],
      license: "Singapore Open Data Licence",
      coverage: "Singapore; census years",
      tags: ["population", "demographics", "census"],
    },
    {
      title: "Singapore Islamic Schools Directory",
      description:
        "A directory of madrasahs and Islamic learning providers serving the Singapore community.",
      source: "MSOCIETY community",
      link: "https://data.gov.sg/",
      category: "educational",
      formats: ["CSV", "JSON"],
      license: "CC BY 4.0",
      coverage: "Singapore",
      tags: ["madrasah", "schools", "education"],
    },
    {
      title: "Halal Food Establishments",
      description:
        "Open directory data for halal-certified food establishments in Singapore.",
      source: "Singapore Food Agency / MUIS",
      link: "https://data.gov.sg/",
      category: "business_economy",
      formats: ["CSV", "JSON"],
      license: "Singapore Open Data Licence",
      coverage: "Singapore",
      tags: ["halal", "food", "businesses"],
    },
    {
      title: "Singapore Muslim Health and Wellbeing Resources",
      description:
        "A curated dataset of community health, counselling, and wellbeing resources relevant to Muslims in Singapore.",
      source: "MSOCIETY community",
      link: "https://github.com/msociety/muslim-health-resources",
      category: "health_wellness",
      formats: ["JSON", "CSV"],
      license: "CC BY 4.0",
      coverage: "Singapore",
      tags: ["health", "counselling", "wellbeing"],
      repoUrl: "https://github.com/msociety/muslim-health-resources",
    },
  ]);

  console.log("Seeding complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
