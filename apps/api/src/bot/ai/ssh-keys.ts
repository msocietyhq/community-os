/**
 * OpenSSH keypair helpers for the agent's computer.
 *
 * Generation and public-key derivation go through `ssh-keygen` rather than
 * a hand-rolled encoder — OpenSSH's on-disk format is easy to get wrong,
 * and the CLI is already required for the exec transport.
 */

import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const dir = await mkdtemp(join(tmpdir(), "agent-ssh-"));
  const keyPath = join(dir, "id_ed25519");
  try {
    const result = await runSshKeygen([
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      keyPath,
      "-C",
      SSH_KEY_COMMENT,
      "-q",
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "ssh-keygen failed");
    }

    const privateKey = await readFile(keyPath, "utf8");
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
    if (!privateKey.includes("BEGIN") || !publicKey.startsWith("ssh-")) {
      throw new Error("ssh-keygen produced an unrecognised key");
    }
    return { privateKey, publicKey };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function derivePublicKey(privateKey: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-ssh-"));
  const keyPath = join(dir, "id");
  try {
    const body = normalizePrivateKey(privateKey);
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
