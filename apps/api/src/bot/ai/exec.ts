/**
 * Remote shell for the computer sub-agent's `exec` tool.
 *
 * The sub-agent only sees a command; this module is the harness that SSHs to a
 * long-lived VM using host/user/key from bot settings. Connection details
 * never belong in the tool schema or the prompt.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clip, clipTail } from "../../lib/text";
import type { SettingsSnapshot } from "@community-os/shared/bot-settings";

export const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
export const MAX_EXEC_TIMEOUT_MS = 300_000;
export const MAX_STDOUT_CHARS = 32_000;
export const MAX_STDERR_CHARS = 8_000;

/** Cap on bytes kept while the command is still running, so a flood cannot OOM. */
const COLLECT_MAX = 80_000;

export const EXEC_TOOL_DESCRIPTION = [
  "Execute a shell command on a remote, persistent Linux VM that you have access to.",
  "The command is run for you automatically — you do not SSH, pick a host, or manage keys.",
  "The same machine is reused across calls, so files, installed packages, and services persist.",
  "Each call starts a fresh shell in the home directory: working directory and environment",
  "variables do not carry over unless you persist them (chain with &&, write to disk, or",
  "update a profile file).",
  "There is no way to poll a running command. If it times out, it may still be running on",
  "the VM — ask the user to check back later; do not retry or wait in a loop.",
  "Use this to inspect the machine, install tools, run programs, or do any work that needs",
  "a real computer. Read the output before deciding the next command.",
].join(" ");

export interface RemoteExecConfig {
  host: string;
  username: string;
  privateKey: string;
  port?: number;
}

export interface ExecTransportResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs `command` on the configured host. Tests inject a stub; production uses
 * OpenSSH (`ssh` on PATH) with a throwaway identity file.
 */
export type ExecTransport = (
  command: string,
  config: RemoteExecConfig,
  timeoutMs: number,
) => Promise<ExecTransportResult>;

export const EXEC_TIMEOUT_MESSAGE =
  "The wait timed out; the command may still be running on the VM. There is no polling — ask the user to check back later, and look then. Do not retry or wait in a loop.";

export interface RemoteExecSuccess {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  /** Present when the wait ended before the process did. */
  message?: string;
}

export interface RemoteExecFailure {
  error: string;
}

export type RemoteExecResult = RemoteExecSuccess | RemoteExecFailure;

export function remoteExecConfigFrom(input: {
  host?: string | null;
  username?: string | null;
  privateKey?: string | null;
  port?: number | null;
}): RemoteExecConfig | null {
  const host = input.host?.trim();
  const username = input.username?.trim();
  const privateKey = input.privateKey?.trim();
  if (!host || !username || !privateKey) return null;
  return {
    host,
    username,
    privateKey,
    ...(input.port ? { port: input.port } : {}),
  };
}

/** Reads the Computer group out of a settings snapshot. */
export function execConfigFromSnapshot(
  settings: SettingsSnapshot,
): RemoteExecConfig | null {
  return remoteExecConfigFrom({
    host: settings["computer.sshHost"],
    username: settings["computer.sshUser"],
    privateKey: settings["computer.sshPrivateKey"],
    port: settings["computer.sshPort"],
  });
}

/**
 * PEM keys in env vars often arrive as a single line with `\n` sequences, or
 * as base64, because platforms dislike multi-line secrets.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.includes("\\n") && !key.includes("\n")) {
    key = key.replace(/\\n/g, "\n");
  }
  if (!key.includes("BEGIN")) {
    const decoded = Buffer.from(key, "base64").toString("utf8").trim();
    if (decoded.includes("BEGIN")) {
      key = decoded;
      if (key.includes("\\n") && !key.includes("\n")) {
        key = key.replace(/\\n/g, "\n");
      }
    }
  }
  return key;
}

export function clampExecTimeoutMs(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    return DEFAULT_EXEC_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(ms), 1_000), MAX_EXEC_TIMEOUT_MS);
}

export async function remoteExec(
  command: string,
  config: RemoteExecConfig,
  options: { timeoutMs?: number; transport?: ExecTransport } = {},
): Promise<RemoteExecResult> {
  const trimmed = command.trim();
  if (trimmed === "") {
    return { error: "command must not be empty" };
  }

  const timeoutMs = clampExecTimeoutMs(options.timeoutMs);
  const transport = options.transport ?? sshCliTransport;

  try {
    const raw = await transport(trimmed, config, timeoutMs);
    return formatExecResult(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: `Could not run that command on the computer: ${reason}` };
  }
}

export function formatExecResult(raw: ExecTransportResult): RemoteExecSuccess {
  // On timeout the latest lines are the progress; a completed flood still
  // keeps the start so a huge listing is readable from the top.
  const clipFn = raw.timedOut ? clipTail : clip;
  const stdout = clipOutput(raw.stdout, MAX_STDOUT_CHARS, clipFn);
  const stderr = clipOutput(raw.stderr, MAX_STDERR_CHARS, clipFn);
  return {
    exitCode: raw.timedOut ? null : raw.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    timedOut: raw.timedOut,
    ...(raw.timedOut ? { message: EXEC_TIMEOUT_MESSAGE } : {}),
  };
}

function clipOutput(
  text: string,
  max: number,
  clipFn: (text: string, max: number) => string,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: clipFn(text, max), truncated: true };
}

/**
 * Ignoring HUP means killing our SSH wait does not take the remote process
 * down with it — a compile or install can finish after we stop listening.
 */
export function wrapRemoteCommand(command: string): string {
  return `trap "" HUP; ${command}`;
}

function chunkToString(chunk: Buffer | string): string {
  if (typeof chunk === "string") return chunk;
  return Buffer.from(chunk).toString("utf8");
}

function appendCapped(buf: string, chunk: Buffer | string): string {
  if (buf.length >= COLLECT_MAX) return buf;
  return buf + chunkToString(chunk).slice(0, COLLECT_MAX - buf.length);
}

async function sshCliTransport(
  command: string,
  config: RemoteExecConfig,
  timeoutMs: number,
): Promise<ExecTransportResult> {
  const dir = await mkdtemp(join(tmpdir(), "agent-exec-"));
  const keyPath = join(dir, `id-${randomUUID()}`);
  await writeFile(keyPath, normalizePrivateKey(config.privateKey), {
    encoding: "utf8",
    mode: 0o600,
  });
  // umask can widen writeFile's mode; OpenSSH refuses a world-readable key.
  await chmod(keyPath, 0o600);

  const connectTimeoutSec = Math.max(
    1,
    Math.min(10, Math.floor(timeoutMs / 1000)),
  );

  try {
    return await runSsh(command, config, keyPath, timeoutMs, connectTimeoutSec);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runSsh(
  command: string,
  config: RemoteExecConfig,
  keyPath: string,
  timeoutMs: number,
  connectTimeoutSec: number,
): Promise<ExecTransportResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ssh",
      [
        "-i",
        keyPath,
        "-p",
        String(config.port ?? 22),
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "PreferredAuthentications=publickey",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        `ConnectTimeout=${connectTimeoutSec}`,
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=4",
        "-o",
        "LogLevel=ERROR",
        `${config.username}@${config.host}`,
        wrapRemoteCommand(command),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (result: ExecTransportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendCapped(stdout, chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendCapped(stderr, chunk);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      finish({
        exitCode: timedOut ? null : code,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
