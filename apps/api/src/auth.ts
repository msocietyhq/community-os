import { betterAuth } from "better-auth";
import { bearer, openAPI } from "better-auth/plugins";
import { telegram } from "better-auth-telegram";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { env } from "./env";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    openAPI(),
    bearer(),
    telegram({
      botToken: env.TELEGRAM_BOT_TOKEN,
      botUsername: env.TELEGRAM_BOT_USERNAME,
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
