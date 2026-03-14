import { db } from "./index";
import { spendCategories, reputationTriggers } from "./schema";
import { DEFAULT_REPUTATION_TRIGGERS } from "@community-os/shared";

async function seed() {
  console.log("Seeding database...");

  // Seed spend categories
  await db
    .insert(spendCategories)
    .values([
      { name: "event", displayName: "Event Expenses", description: "Costs related to community events" },
      { name: "infra", displayName: "Infrastructure", description: "Cloud infrastructure and hosting costs" },
      { name: "misc", displayName: "Miscellaneous", description: "Other community expenses" },
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
      }))
    )
    .onConflictDoNothing();

  console.log("Seeding complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
