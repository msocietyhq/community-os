/**
 * Ensures the computer SSH keypair exists in bot settings.
 *
 * Lives next to the bot rather than in the settings service: generation is
 * a presentation-adjacent side effect of opening Computer or running exec,
 * and the service stays a dumb registry store.
 */

import type { SettingsSnapshot } from "@community-os/shared/bot-settings";
import {
  applyChanges,
  getSettings,
  SYSTEM_ACTOR,
  type Actor,
} from "../../services/bot-settings.service";
import { nextComputerSshKeys, type SshKeyPair } from "./ssh-keys";

/**
 * Serialises generation so two concurrent Computer-menu opens or exec
 * calls cannot mint two pairs and keep only one.
 */
let sshKeyLock: Promise<void> = Promise.resolve();

async function withSshKeyLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void = () => {};
  const previous = sshKeyLock;
  sshKeyLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Makes sure a keypair exists. Generates once when the private key is
 * missing; derives the public key if a leftover private key has none.
 * `force` rotates the pair (the menu's Regenerate).
 */
export async function ensureComputerSshKey(
  options: {
    force?: boolean;
    actor?: Actor;
    generate?: () => Promise<SshKeyPair>;
    derivePublic?: (privateKey: string) => Promise<string>;
  } = {},
): Promise<SettingsSnapshot> {
  return withSshKeyLock(async () => {
    const before = await getSettings();
    const next = await nextComputerSshKeys(
      {
        privateKey: before["computer.sshPrivateKey"],
        publicKey: before["computer.sshPublicKey"],
      },
      {
        force: options.force,
        generate: options.generate,
        derivePublic: options.derivePublic,
      },
    );
    if (!next) return before;

    const changes = [
      {
        key: "computer.sshPrivateKey" as const,
        from: before["computer.sshPrivateKey"],
        to: next.privateKey,
      },
      {
        key: "computer.sshPublicKey" as const,
        from: before["computer.sshPublicKey"],
        to: next.publicKey,
      },
    ].filter((change) => change.from !== change.to);

    if (changes.length === 0) return before;

    await applyChanges(changes, options.actor ?? SYSTEM_ACTOR);
    return getSettings();
  });
}
