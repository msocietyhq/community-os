import { treaty, type Treaty } from "@elysiajs/eden";
import type { App } from "@community-os/api";

/** In production VITE_API_URL points to the API subdomain (e.g. https://api.msociety.dev).
 *  In dev the Vite proxy handles /api, so we fall back to the current origin. */
const apiBase = import.meta.env.VITE_API_URL || window.location.origin;

export const api: Treaty.Create<App> = treaty<App>(apiBase, {
  fetch: { credentials: "include" },
});

export { apiBase };
