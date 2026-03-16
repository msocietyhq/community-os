import { createAuthClient } from "better-auth/react";
import { telegramClient } from "better-auth-telegram/client";
import { apiBase } from "./api-client";

export const authClient = createAuthClient({
  baseURL: apiBase,
  fetchOptions: {
    credentials: "include" as RequestCredentials,
  },
  plugins: [telegramClient()],
});
