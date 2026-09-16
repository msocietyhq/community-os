import { describe, expect, test } from "bun:test";
import { resolveBinary, SSH_MISSING_MESSAGE } from "./ssh-bin";

describe("resolveBinary", () => {
  test("prefers a PATH hit over /usr/bin", () => {
    expect(
      resolveBinary("ssh", {
        which: () => "/opt/custom/ssh",
        exists: () => true,
      }),
    ).toBe("/opt/custom/ssh");
  });

  test("falls back to /usr/bin when PATH is empty", () => {
    expect(
      resolveBinary("ssh", {
        which: () => null,
        exists: (path) => path === "/usr/bin/ssh",
      }),
    ).toBe("/usr/bin/ssh");
  });

  test("returns null when the binary is nowhere", () => {
    expect(
      resolveBinary("ssh", {
        which: () => null,
        exists: () => false,
      }),
    ).toBeNull();
  });
});

describe("SSH_MISSING_MESSAGE", () => {
  test("names the package the API host must install", () => {
    expect(SSH_MISSING_MESSAGE).toContain("openssh-client");
  });
});
