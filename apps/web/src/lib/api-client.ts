// TODO: Replace with Eden Treaty client once API types are exported
// import { treaty } from "@elysiajs/eden";
// import type { App } from "@community-os/api";
// export const api = treaty<App>(window.location.origin);

export const api = {
  async get(path: string) {
    const res = await fetch(`/api/v1${path}`, {
      credentials: "include",
    });
    return res.json();
  },

  async post(path: string, body?: unknown) {
    const res = await fetch(`/api/v1${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  },

  async patch(path: string, body: unknown) {
    const res = await fetch(`/api/v1${path}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};
