import { treaty, type Treaty } from "@elysiajs/eden";
import type { App } from "@community-os/api";

export const api: Treaty.Create<App> = treaty<App>(window.location.origin);
