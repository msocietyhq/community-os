import { env } from "../env";

// TODO: Replace with Eden Treaty client once API types are exported
// import { treaty } from "@elysiajs/eden";
// import type { App } from "@community-os/api";
// export const apiClient = treaty<App>(env.API_URL);

export const apiClient = {
  baseUrl: env.API_URL,

  async get(path: string, token?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    return res.json();
  },

  async post(path: string, body: unknown, token?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return res.json();
  },
};
