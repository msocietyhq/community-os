/**
 * OpenSSH keypair helpers for the agent's computer.
 *
 * Generation and public-key derivation use `micro-key-producer`, not
 * `ssh-keygen`. OpenSSH's on-disk format is easy to get wrong, and the
 * Railway image the API deploys to does not ship `openssh-client` — spawning
 * `ssh-keygen` left Computer with no key and Regenerate showing
 * "Could not generate a key."
 *
 * Leftover private keys that aren't OpenSSH-format still fall through to
 * `ssh-keygen -y` when the binary is present.
 */

import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatPublicKey,
  getKeys,
  PrivateExport,
} from "micro-key-producer/ssh.js";
import { randomBytes } from "micro-key-producer/utils.js";
import { normalizePrivateKey } from "./exec";

export const SSH_KEY_COMMENT = "community-os-computer";

export interface SshKeyPair {
  privateKey: string;
  publicKey: string;
}

export type SshKeyPlan = "keep" | "generate" | "derive";

/**
 * What to do with the stored pair. Force always mints a new one (rotate).
 * An existing private key with no public is the leftover of a paste-in-PEM
 * deploy — derive rather than rotate, so authorized_keys already on the VM
 * keep working.
 */
export function sshKeyPlan(
  privateKey: string,
  publicKey: string,
  force: boolean,
): SshKeyPlan {
  if (force) return "generate";
  if (privateKey.trim() === "") return "generate";
  if (publicKey.trim() === "") return "derive";
  return "keep";
}

export async function nextComputerSshKeys(
  current: { privateKey: string; publicKey: string },
  options: {
    force?: boolean;
    generate?: () => Promise<SshKeyPair>;
    derivePublic?: (privateKey: string) => Promise<string>;
  } = {},
): Promise<SshKeyPair | null> {
  const plan = sshKeyPlan(
    current.privateKey,
    current.publicKey,
    options.force === true,
  );
  if (plan === "keep") return null;

  const generate = options.generate ?? generateEd25519KeyPair;
  const derivePublic = options.derivePublic ?? derivePublicKey;

  if (plan === "generate") return generate();

  const publicKey = await derivePublic(current.privateKey);
  return { privateKey: current.privateKey, publicKey };
}

export async function generateEd25519KeyPair(): Promise<SshKeyPair> {
  const produced = getKeys(randomBytes(32), SSH_KEY_COMMENT);
  const privateKey = produced.privateKey.endsWith("\n")
    ? produced.privateKey
    : `${produced.privateKey}\n`;
  const publicKey = produced.publicKey.trim();
  if (
    !privateKey.includes("BEGIN OPENSSH PRIVATE KEY") ||
    !publicKey.startsWith("ssh-ed25519 ")
  ) {
    throw new Error("key producer produced an unrecognised key");
  }
  return { privateKey, publicKey };
}

export async function derivePublicKey(privateKey: string): Promise<string> {
  const body = normalizePrivateKey(privateKey);
  const fromOpenSsh = publicKeyFromOpenSshPrivate(body);
  if (fromOpenSsh) return fromOpenSsh;

  const dir = await mkdtemp(join(tmpdir(), "agent-ssh-"));
  const keyPath = join(dir, "id");
  try {
    await writeFile(keyPath, body.endsWith("\n") ? body : `${body}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(keyPath, 0o600);

    const result = await runSshKeygen(["-y", "-f", keyPath]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "ssh-keygen -y failed");
    }

    const publicKey = result.stdout.trim();
    if (!publicKey.startsWith("ssh-")) {
      throw new Error(
        "could not derive a public key from the stored private key",
      );
    }
    return publicKey;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function publicKeyFromOpenSshPrivate(privateKey: string): string | null {
  try {
    const decoded = PrivateExport.decode(privateKey);
    const first = decoded.keys[0];
    if (!first) return null;
    const comment = first.privKey.comment;
    return formatPublicKey(
      first.pubKey.pubKey,
      comment === "" ? undefined : comment,
    ).trim();
  } catch {
    return null;
  }
}

function runSshKeygen(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ssh-keygen", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}
