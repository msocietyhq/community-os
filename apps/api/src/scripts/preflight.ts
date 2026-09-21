// Runs before the real server starts (see package.json's "start" script),
// specifically before `../env.ts`'s Zod schema parses `process.env` — which
// happens the instant `index.ts`'s module graph loads, too early for an
// async fetch to land first. So this is a separate process instead: it
// resolves DATABASE_URL (and anything else in the bundle) for a PR preview
// environment and writes it to `.env.runtime`, which `bun --env-file` loads
// for the actual server process.
//
// A complete no-op — writes an empty file and exits 0 — everywhere except a
// Railway PR environment: local dev and production/staging never set
// PROJECT_BOOTSTRAP_TOKEN, and a non-PR Railway environment name won't match
// `pr-<n>`. Deliberately reads `process.env` directly rather than importing
// `../env` — that module's schema requires vars this very script exists to
// provide, so importing it here would throw before preflight ever runs.
import { writeFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_ENV_PATH = path.resolve(import.meta.dir, "../../.env.runtime");
const PR_ENVIRONMENT_PATTERN = /^pr-(\d+)$/;

function writeRuntimeEnv(vars: Record<string, string>): void {
  const lines = Object.entries(vars).map(
    ([key, value]) => `${key}=${JSON.stringify(value)}`,
  );
  writeFileSync(RUNTIME_ENV_PATH, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const bootstrapToken = process.env.PROJECT_BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    writeRuntimeEnv({});
    return;
  }

  const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME ?? "";
  const match = PR_ENVIRONMENT_PATTERN.exec(environmentName);
  if (!match) {
    console.log(
      `[preflight] PROJECT_BOOTSTRAP_TOKEN is set but RAILWAY_ENVIRONMENT_NAME ` +
        `("${environmentName}") isn't a PR environment — skipping self-configure`,
    );
    writeRuntimeEnv({});
    return;
  }

  const prNumber = Number(match[1]);
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new Error(
      "[preflight] PROJECT_BOOTSTRAP_TOKEN is set but API_URL is not — cannot self-configure",
    );
  }

  console.log(`[preflight] Self-configuring for PR #${prNumber}...`);

  const res = await fetch(`${apiUrl}/api/v1/dev-environments/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": bootstrapToken,
    },
    body: JSON.stringify({ prNumber }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[preflight] Bootstrap request failed: ${res.status} ${body}`,
    );
  }

  const { vars } = (await res.json()) as { vars: Record<string, string> };
  writeRuntimeEnv(vars);
  console.log(
    `[preflight] Self-configured ${Object.keys(vars).length} env var(s) for PR #${prNumber}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
