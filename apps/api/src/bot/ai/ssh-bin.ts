/**
 * Locates the OpenSSH binaries the computer exec transport needs.
 *
 * Key generation is in-process. Exec still shells out to `ssh`, so the API
 * host must ship `openssh-client` (see railpack.json / nixpacks.toml).
 */

import { existsSync } from "node:fs";

export const SSH_MISSING_MESSAGE =
  "ssh is not installed on this host (need the openssh-client package)";

/**
 * PATH first, then the Debian/Ubuntu default. Tests inject `which` / `exists`.
 */
export function resolveBinary(
  name: string,
  options: {
    which?: (name: string) => string | null;
    exists?: (path: string) => boolean;
  } = {},
): string | null {
  const which = options.which ?? ((n) => Bun.which(n) ?? null);
  const exists = options.exists ?? existsSync;
  const fromPath = which(name);
  if (fromPath) return fromPath;
  const fallback = `/usr/bin/${name}`;
  return exists(fallback) ? fallback : null;
}

export function resolveSsh(): string | null {
  return resolveBinary("ssh");
}

export function logComputerRuntimeDeps(): void {
  const ssh = resolveSsh();
  if (ssh) {
    console.log(`[computer] ssh: ${ssh}`);
    return;
  }
  console.warn(`[computer] ${SSH_MISSING_MESSAGE}`);
}
