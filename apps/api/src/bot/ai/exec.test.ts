import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  stripBashInitNoise,
  wrapRemoteCommand,
  EXEC_MAX_LIFETIME_SEC,
  EXEC_KILL_GRACE_SEC,
  EXEC_MARKER_ENV,
  execReaperCommand,
  reapOrphanedExecs,
  type ExecTransportResult,
  type RemoteExecConfig,
} from "./exec";
import { generateEd25519KeyPair } from "./ssh-keys";
import { resolveBinary } from "./ssh-bin";
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

/** Ubuntu-style home: .profile sources .bashrc, .bashrc is interactive-only. */
async function mkLoginHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "exec-login-"));
  await writeFile(join(home, ".hushlogin"), "");
  await writeFile(
    join(home, ".bashrc"),
    [
      "case $- in",
      "    *i*) ;;",
      "      *) return;;",
      "esac",
      'export PATH="$HOME/bin:$PATH"',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(home, ".profile"),
    [
      'if [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then',
      '  . "$HOME/.bashrc"',
      "fi",
      "",
    ].join("\n"),
  );
  await mkdir(join(home, "bin"));
  await writeFile(join(home, "bin", "mytool"), "#!/bin/sh\necho mytool-ok\n", {
    mode: 0o755,
  });
  await chmod(join(home, "bin", "mytool"), 0o755);
  return home;
}

function loginHomeEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    PATH: "/usr/bin:/bin",
    USER: "agent",
    TERM: "xterm",
    LANG: "C",
  };
}

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
  test("appends the trailing newline OpenSSH needs to load the key", () => {
    expect(PEM.endsWith("\n")).toBe(false);
    expect(normalizePrivateKey(PEM)).toBe(`${PEM}\n`);
  });

  test("does not double a trailing newline that is already present", () => {
    expect(normalizePrivateKey(`${PEM}\n`)).toBe(`${PEM}\n`);
  });

  test("turns literal \\n sequences into newlines", () => {
    const escaped = PEM.replace(/\n/g, "\\n");
    expect(escaped).not.toContain("\n");
    expect(normalizePrivateKey(escaped)).toBe(`${PEM}\n`);
  });

  test("decodes a base64-encoded PEM", () => {
    const encoded = Buffer.from(PEM, "utf8").toString("base64");
    expect(encoded).not.toContain("BEGIN");
    expect(normalizePrivateKey(encoded)).toBe(`${PEM}\n`);
  });

  // Exec trims the stored key before writing the throwaway identity file.
  // OpenSSH 9.6 + OpenSSL 3 then fails with "Load key: error in libcrypto"
  // and never offers the key, so the VM answers Permission denied.
  //
  // Skipped where openssh-client isn't installed (e.g. Railway's Nixpacks
  // Bun image) rather than failing to spawn ssh-keygen outright.
  test.skipIf(!resolveBinary("ssh-keygen"))(
    "OpenSSH can load a generated key after normalizePrivateKey",
    async () => {
      const pair = await generateEd25519KeyPair();
      const dir = await mkdtemp(join(tmpdir(), "exec-key-"));
      const keyPath = join(dir, "id");
      try {
        await writeFile(keyPath, normalizePrivateKey(pair.privateKey.trim()), {
          encoding: "utf8",
          mode: 0o600,
        });
        await chmod(keyPath, 0o600);
        const result = Bun.spawnSync(["ssh-keygen", "-y", "-f", keyPath], {
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.stderr.toString()).not.toContain("libcrypto");
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toContain("ssh-ed25519");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
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
  test("strips bash init noise before returning streams", () => {
    const out = formatExecResult(
      ok({
        stdout:
          'To run a command as administrator (user "root"), use "sudo <command>".\nSee "man sudo_root" for details.\n\nhello\n',
        stderr:
          "bash: cannot set terminal process group (9): Inappropriate ioctl for device\nbash: no job control in this shell\nwarn\n",
      }),
    );
    expect(out.stdout).toBe("hello\n");
    expect(out.stderr).toBe("warn\n");
    expect(out.truncated).toBe(false);
  });

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
    expect(out.message).toContain("killed after 10 minutes");
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
    expect(EXEC_TOOL_DESCRIPTION).toContain("fresh login bash");
    expect(EXEC_TOOL_DESCRIPTION).toContain("bashrc");
  });

  test("tells the model not to poll a timeout, and that leftovers die after 10 minutes", () => {
    expect(EXEC_TOOL_DESCRIPTION).toContain("no way to poll");
    expect(EXEC_TOOL_DESCRIPTION).toContain("up to 10 minutes");
    expect(EXEC_TOOL_DESCRIPTION).toContain("killed");
    expect(EXEC_TOOL_DESCRIPTION).toContain("check back later");
    expect(EXEC_TOOL_DESCRIPTION).toContain("do not retry");
  });
});

describe("wrapRemoteCommand", () => {
  test("ignores hangup so a wait timeout does not kill the remote process", () => {
    expect(wrapRemoteCommand("sleep 120")).toContain('trap "" HUP');
  });

  test("kills the remote process after 10 minutes so leftovers cannot linger", () => {
    expect(EXEC_MAX_LIFETIME_SEC).toBe(600);
    expect(EXEC_KILL_GRACE_SEC).toBe(10);
    const wrapped = wrapRemoteCommand("sleep 120");
    expect(wrapped).toContain(
      `timeout --kill-after=${EXEC_KILL_GRACE_SEC}s ${EXEC_MAX_LIFETIME_SEC}`,
    );
  });

  test("the user command is preserved through the wrapper", () => {
    const command = `echo "it's fine"; foo | bar && baz`;
    const wrapped = wrapRemoteCommand(command);
    const match = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d/.exec(wrapped);
    expect(match?.[1]).toBeDefined();
    const payload = match?.[1];
    expect(payload).toBeTruthy();
    if (!payload) return;
    expect(Buffer.from(payload, "base64").toString("utf8")).toBe(command);
  });

  test("the wrapper actually runs the encoded command", async () => {
    const home = await mkLoginHome();
    try {
      const wrapped = wrapRemoteCommand("printf 'ok-from-wrapper\\n'");
      const result = Bun.spawnSync(["sh", "-c", wrapped], {
        stdout: "pipe",
        stderr: "pipe",
        env: loginHomeEnv(home),
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("ok-from-wrapper\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("runs in an interactive login bash so a typical bashrc PATH is loaded", async () => {
    const home = await mkLoginHome();
    try {
      const wrapped = wrapRemoteCommand("command -v mytool");
      const result = Bun.spawnSync(["sh", "-c", wrapped], {
        stdout: "pipe",
        stderr: "pipe",
        env: loginHomeEnv(home),
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(`${home}/bin/mytool`);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("does not pipe the command to sh — that skips bashrc", () => {
    const wrapped = wrapRemoteCommand("true");
    expect(wrapped).toContain("bash +H -ilc");
    expect(wrapped).not.toMatch(/\bsh$/);
    expect(wrapped).not.toMatch(/timeout [^;]* sh\b/);
  });

  test("marks the process so a restart can reap leftovers", () => {
    expect(EXEC_MARKER_ENV).toBe("MSOCIETY_AGENT_EXEC");
    expect(wrapRemoteCommand("true")).toContain(
      `env ${EXEC_MARKER_ENV}=1 timeout`,
    );
  });
});

describe("stripBashInitNoise", () => {
  test("drops interactive-bash job-control warnings from stderr", () => {
    expect(
      stripBashInitNoise(
        "bash: cannot set terminal process group (1234): Inappropriate ioctl for device\nbash: no job control in this shell\nreal error\n",
      ),
    ).toBe("real error\n");
  });

  test("drops the Ubuntu sudo hint that login bash prints on stdout", () => {
    expect(
      stripBashInitNoise(
        'To run a command as administrator (user "root"), use "sudo <command>".\nSee "man sudo_root" for details.\n\nok\n',
      ),
    ).toBe("ok\n");
  });
});

describe("execReaperCommand", () => {
  test("signals marked processes, then kills whoever survives the grace", () => {
    const script = execReaperCommand(0);
    expect(script).toContain(EXEC_MARKER_ENV);
    expect(script).toContain("kill -s TERM $pids");
    expect(script).toContain("kill -s KILL $pids");
    expect(script).toContain("sleep 0");
  });

  test("kills a marked leftover and leaves unmarked processes alone", async () => {
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== EXEC_MARKER_ENV),
    );
    const marked = Bun.spawn(["sleep", "60"], {
      env: { ...cleanEnv, [EXEC_MARKER_ENV]: "1" },
      stdout: "ignore",
      stderr: "ignore",
    });
    const unmarked = Bun.spawn(["sleep", "60"], {
      env: cleanEnv,
      stdout: "ignore",
      stderr: "ignore",
    });

    try {
      const result = Bun.spawnSync(["sh", "-c", execReaperCommand(0)], {
        env: cleanEnv,
      });
      expect(result.exitCode).toBe(0);

      const unmarkedAlive = Bun.spawnSync(["kill", "-0", String(unmarked.pid)]);
      expect(unmarkedAlive.exitCode).toBe(0);

      const timedOut = await Promise.race([
        marked.exited.then(() => false),
        Bun.sleep(1000).then(() => true),
      ]);
      expect(timedOut).toBe(false);
    } finally {
      marked.kill();
      unmarked.kill();
    }
  });
});

describe("reapOrphanedExecs", () => {
  test("is a no-op when the computer is not configured", async () => {
    let called = false;
    const outcome = await reapOrphanedExecs(null, {
      transport: async () => {
        called = true;
        return ok();
      },
    });
    expect(called).toBe(false);
    expect(outcome).toEqual({ skipped: true });
  });

  test("runs the reaper over SSH without wrapping it as an exec", async () => {
    let seen = "";
    const outcome = await reapOrphanedExecs(CONFIG, {
      transport: async (command) => {
        seen = command;
        return ok({ stdout: "reaped\n" });
      },
    });
    expect(seen).toContain(EXEC_MARKER_ENV);
    expect(seen).toContain("kill -s TERM");
    expect(seen).toContain("kill -s KILL");
    expect(seen).not.toContain('trap "" HUP');
    expect(outcome).toEqual({
      skipped: false,
      result: {
        exitCode: 0,
        stdout: "reaped\n",
        stderr: "",
        truncated: false,
        timedOut: false,
      },
    });
  });
});
