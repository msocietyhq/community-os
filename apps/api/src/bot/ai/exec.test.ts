import { describe, expect, test } from "bun:test";
import {
  clampExecTimeoutMs,
  DEFAULT_EXEC_TIMEOUT_MS,
  EXEC_TIMEOUT_MESSAGE,
  EXEC_TOOL_DESCRIPTION,
  execConfigFromSnapshot,
  formatExecResult,
  MAX_EXEC_TIMEOUT_MS,
  MAX_STDERR_CHARS,
  MAX_STDOUT_CHARS,
  normalizePrivateKey,
  remoteExec,
  remoteExecConfigFrom,
  wrapRemoteCommand,
  type ExecTransportResult,
  type RemoteExecConfig,
} from "./exec";
import {
  BOT_SETTINGS,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";

const PEM = `-----BEGIN OPENSSH PRIVATE KEY-----
abc
-----END OPENSSH PRIVATE KEY-----`;

const CONFIG: RemoteExecConfig = {
  host: "vm.example",
  username: "agent",
  privateKey: PEM,
};

const ok = (
  overrides: Partial<ExecTransportResult> = {},
): ExecTransportResult => ({
  exitCode: 0,
  stdout: "hello",
  stderr: "",
  timedOut: false,
  ...overrides,
});

describe("remoteExecConfigFrom", () => {
  test("requires host, user and private key", () => {
    expect(remoteExecConfigFrom({})).toBeNull();
    expect(
      remoteExecConfigFrom({
        host: "vm.example",
        username: "agent",
      }),
    ).toBeNull();
    expect(
      remoteExecConfigFrom({
        host: "  ",
        username: "agent",
        privateKey: PEM,
      }),
    ).toBeNull();
  });

  test("returns a config when all three are set", () => {
    expect(
      remoteExecConfigFrom({
        host: " vm.example ",
        username: "agent",
        privateKey: PEM,
        port: 2222,
      }),
    ).toEqual({
      host: "vm.example",
      username: "agent",
      privateKey: PEM,
      port: 2222,
    });
  });
});

describe("execConfigFromSnapshot", () => {
  const empty = Object.fromEntries(
    Object.entries(BOT_SETTINGS).map(([key, def]) => [key, def.default]),
  ) as SettingsSnapshot;

  test("defaults are unconfigured", () => {
    expect(execConfigFromSnapshot(empty)).toBeNull();
  });

  test("host, user and key together enable the computer", () => {
    expect(
      execConfigFromSnapshot({
        ...empty,
        "computer.sshHost": "vm.example",
        "computer.sshUser": "agent",
        "computer.sshPrivateKey": PEM,
        "computer.sshPort": 2222,
      }),
    ).toEqual({
      host: "vm.example",
      username: "agent",
      privateKey: PEM,
      port: 2222,
    });
  });
});

describe("normalizePrivateKey", () => {
  test("leaves a real PEM alone", () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  test("turns literal \\n sequences into newlines", () => {
    const escaped = PEM.replace(/\n/g, "\\n");
    expect(escaped).not.toContain("\n");
    expect(normalizePrivateKey(escaped)).toBe(PEM);
  });

  test("decodes a base64-encoded PEM", () => {
    const encoded = Buffer.from(PEM, "utf8").toString("base64");
    expect(encoded).not.toContain("BEGIN");
    expect(normalizePrivateKey(encoded)).toBe(PEM);
  });
});

describe("clampExecTimeoutMs", () => {
  test("defaults, floors, and caps", () => {
    expect(clampExecTimeoutMs(undefined)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampExecTimeoutMs(0)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampExecTimeoutMs(500)).toBe(1_000);
    expect(clampExecTimeoutMs(MAX_EXEC_TIMEOUT_MS + 1)).toBe(
      MAX_EXEC_TIMEOUT_MS,
    );
  });
});

describe("formatExecResult", () => {
  test("clips oversized streams and marks truncated", () => {
    const out = formatExecResult(
      ok({
        stdout: "S".repeat(MAX_STDOUT_CHARS + 50),
        stderr: "E".repeat(MAX_STDERR_CHARS + 50),
      }),
    );
    expect(out.truncated).toBe(true);
    expect(out.stdout.length).toBe(MAX_STDOUT_CHARS);
    expect(out.stderr.length).toBe(MAX_STDERR_CHARS);
    expect(out.stdout.endsWith("…")).toBe(true);
  });

  test("clears the exit code when the command timed out", () => {
    const out = formatExecResult(
      ok({ exitCode: 137, timedOut: true, stdout: "partial" }),
    );
    expect(out.timedOut).toBe(true);
    expect(out.exitCode).toBeNull();
    expect(out.stdout).toBe("partial");
    expect(out.truncated).toBe(false);
    expect(out.message).toBe(EXEC_TIMEOUT_MESSAGE);
  });

  test("on timeout keeps the tail of a long log, not the start", () => {
    const out = formatExecResult(
      ok({
        timedOut: true,
        stdout: `${"A".repeat(MAX_STDOUT_CHARS)}TAIL`,
      }),
    );
    expect(out.truncated).toBe(true);
    expect(out.stdout.startsWith("…")).toBe(true);
    expect(out.stdout.endsWith("TAIL")).toBe(true);
    expect(out.message).toContain("check back later");
    expect(out.message).toContain("no polling");
  });

  test("a finished command does not carry the timeout message", () => {
    expect(formatExecResult(ok()).message).toBeUndefined();
  });
});

describe("remoteExec", () => {
  test("rejects an empty command without calling the transport", async () => {
    let called = false;
    const result = await remoteExec("   ", CONFIG, {
      transport: async () => {
        called = true;
        return ok();
      },
    });
    expect(called).toBe(false);
    expect(result).toEqual({ error: "command must not be empty" });
  });

  test("returns stdout, stderr and exit code from the transport", async () => {
    const result = await remoteExec("ls /tmp", CONFIG, {
      transport: async (command, config, timeoutMs) => {
        expect(command).toBe("ls /tmp");
        expect(config.host).toBe("vm.example");
        expect(timeoutMs).toBe(DEFAULT_EXEC_TIMEOUT_MS);
        return ok({ stdout: "a\nb\n", stderr: "warn\n", exitCode: 0 });
      },
    });
    expect(result).toEqual({
      exitCode: 0,
      stdout: "a\nb\n",
      stderr: "warn\n",
      truncated: false,
      timedOut: false,
    });
  });

  test("honours a caller-supplied timeout", async () => {
    let seen = 0;
    await remoteExec("sleep 1", CONFIG, {
      timeoutMs: 5_000,
      transport: async (_c, _cfg, timeoutMs) => {
        seen = timeoutMs;
        return ok();
      },
    });
    expect(seen).toBe(5_000);
  });

  test("turns a transport throw into an actionable error", async () => {
    const result = await remoteExec("ls", CONFIG, {
      transport: async () => {
        throw new Error("ssh ENOENT");
      },
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("ssh ENOENT");
      expect(result.error).toContain("computer");
    }
  });

  test("the default transport reports a failure instead of hanging", async () => {
    const result = await remoteExec(
      "true",
      {
        host: "127.0.0.1",
        username: "agent",
        privateKey: PEM,
        port: 1,
      },
      { timeoutMs: 3_000 },
    );
    if ("error" in result) {
      expect(result.error).toContain("computer");
      return;
    }
    expect(result.timedOut || result.exitCode !== 0).toBe(true);
  });
});

describe("EXEC_TOOL_DESCRIPTION", () => {
  test("tells the model it is a remote persistent VM, executed automatically", () => {
    expect(EXEC_TOOL_DESCRIPTION).toContain("remote, persistent Linux VM");
    expect(EXEC_TOOL_DESCRIPTION).toContain("automatically");
    expect(EXEC_TOOL_DESCRIPTION).toContain("do not SSH");
    expect(EXEC_TOOL_DESCRIPTION).toContain("fresh shell");
  });

  test("tells the model not to poll a timeout, and to ask the user to check later", () => {
    expect(EXEC_TOOL_DESCRIPTION).toContain("no way to poll");
    expect(EXEC_TOOL_DESCRIPTION).toContain("check back later");
    expect(EXEC_TOOL_DESCRIPTION).toContain("do not retry");
  });
});

describe("wrapRemoteCommand", () => {
  test("ignores hangup so a timeout does not kill the remote process", () => {
    expect(wrapRemoteCommand("sleep 120")).toBe('trap "" HUP; sleep 120');
  });
});
