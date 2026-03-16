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

export const authOpenAPI = {
  getPaths: (prefix = "/api/auth") =>
    getSchema().then(({ paths }) => {
      const reference: typeof paths = Object.create(null);
      for (const path of Object.keys(paths)) {
        const entry = paths[path];
        if (!entry) continue;
        const key = prefix + path;
        reference[key] = entry;
        for (const method of Object.keys(entry)) {
          const operation = (reference[key] as any)[method];
          operation.tags = ["Auth"];
        }
      }
      return reference;
    }) as Promise<any>,
  components: getSchema().then(({ components }) => components) as Promise<any>,
} as const;
