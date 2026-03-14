import { treaty, type Treaty } from "@elysiajs/eden";
import type { App } from "@community-os/api";
import { env } from "../env";

export const apiClient: Treaty.Create<App> = treaty<App>(env.API_URL);
