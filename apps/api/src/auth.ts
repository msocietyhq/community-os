import type { openapi as elysiaOpenAPI } from "@elysiajs/openapi";
import { betterAuth } from "better-auth";
import { bearer, openAPI } from "better-auth/plugins";
import { telegram } from "better-auth-telegram";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { env } from "./env";
import { createAuditEntry } from "./middleware/audit";
import { membersService } from "./services/members.service";

const webHost = new URL(env.WEB_URL).hostname;
const isLocalhost = webHost === "localhost" || webHost === "127.0.0.1";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.API_URL,
  trustedOrigins: [env.WEB_URL],
  emailAndPassword: {
    enabled: true,
  },
  ...(!isLocalhost && {
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain: `.${webHost}`,
      },
    },
  }),
  plugins: [
    openAPI(),
    bearer(),
    telegram({
      botToken: env.TELEGRAM_BOT_TOKEN,
      botUsername: env.TELEGRAM_BOT_USERNAME,
      autoCreateUser: false,
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "member",
      },
      banned: {
        type: "boolean",
        defaultValue: false,
      },
      // Read-only on the session so the web app can link a signed-in user to
      // their own public profile at /member/:username. `input: false` keeps it
      // out of sign-up payloads — it's set by the Telegram login flow.
      telegramUsername: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          membersService.createIfNotExists(user.id).catch(console.error);
          createAuditEntry({
            entityType: "member",
            entityId: user.id,
            action: "create",
            newValue: user,
          }).catch(console.error);
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          createAuditEntry({
            entityType: "member",
            entityId: session.userId,
            action: "approve",
            newValue: { type: "login", sessionToken: session.token },
          }).catch(console.error);
        },
      },
    },
  },
});

let _schema: ReturnType<typeof auth.api.generateOpenAPISchema>;
const getSchema = async () => (_schema ??= auth.api.generateOpenAPISchema());

/** The slice of an OpenAPI operation object this module rewrites. */
type OpenAPIOperation = { tags?: string[] };

/**
 * Better Auth generates its own OpenAPI shapes, which are structurally looser
 * than what the Elysia plugin accepts (e.g. it emits a "date" schema type).
 * Borrow the plugin's own types so the bridge is an explicit, checked cast
 * rather than an `any` hole.
 */
export type Documentation = NonNullable<
  Parameters<typeof elysiaOpenAPI>[0]
>["documentation"];
export type OpenAPIPaths = NonNullable<NonNullable<Documentation>["paths"]>;
export type OpenAPIComponents = NonNullable<
  NonNullable<Documentation>["components"]
>;

export const authOpenAPI: {
  getPaths: (prefix?: string) => Promise<OpenAPIPaths>;
  components: Promise<OpenAPIComponents>;
} = {
  getPaths: (prefix = "/api/auth") =>
    getSchema().then(({ paths }) => {
      const reference: typeof paths = Object.create(null);
      for (const path of Object.keys(paths)) {
        const entry = paths[path];
        if (!entry) continue;
        const key = prefix + path;
        reference[key] = entry;
        for (const method of Object.keys(entry)) {
          const operation = (entry as Record<string, OpenAPIOperation>)[method];
          if (!operation) continue;
          operation.tags = ["Auth"];
        }
      }
      return reference as unknown as OpenAPIPaths;
    }),
  components: getSchema().then(
    ({ components }) => components as unknown as OpenAPIComponents,
  ),
};
