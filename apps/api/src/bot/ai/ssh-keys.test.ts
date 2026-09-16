import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  derivePublicKey,
  generateEd25519KeyPair,
  nextComputerSshKeys,
  sshKeyPlan,
  SSH_KEY_COMMENT,
} from "./ssh-keys";

describe("sshKeyPlan", () => {
  test("generates when nothing is stored", () => {
    expect(sshKeyPlan("", "", false)).toBe("generate");
    expect(sshKeyPlan("  ", "  ", false)).toBe("generate");
  });

  test("derives the public key when only the private is stored", () => {
    expect(sshKeyPlan("BEGIN KEY", "", false)).toBe("derive");
  });

  test("keeps a complete pair", () => {
    expect(sshKeyPlan("BEGIN KEY", "ssh-ed25519 AAAA", false)).toBe("keep");
  });

  test("force always generates, even when a pair exists", () => {
    expect(sshKeyPlan("BEGIN KEY", "ssh-ed25519 AAAA", true)).toBe("generate");
    expect(sshKeyPlan("", "", true)).toBe("generate");
  });
});

describe("nextComputerSshKeys", () => {
  const pair = {
    privateKey: "PRIVATE",
    publicKey: "ssh-ed25519 AAAA comment",
  };

  test("returns null when the stored pair is complete", async () => {
    expect(
      await nextComputerSshKeys(
        { privateKey: pair.privateKey, publicKey: pair.publicKey },
        {
          generate: async () => {
            throw new Error("should not generate");
          },
          derivePublic: async () => {
            throw new Error("should not derive");
          },
        },
      ),
    ).toBeNull();
  });

  test("mints a pair when the private key is missing", async () => {
    expect(
      await nextComputerSshKeys(
        { privateKey: "", publicKey: "" },
        {
          generate: async () => pair,
          derivePublic: async () => {
            throw new Error("should not derive");
          },
        },
      ),
    ).toEqual(pair);
  });

  test("derives the public key from a leftover private key", async () => {
    expect(
      await nextComputerSshKeys(
        { privateKey: pair.privateKey, publicKey: "" },
        {
          generate: async () => {
            throw new Error("should not generate");
          },
          derivePublic: async (privateKey) => {
            expect(privateKey).toBe(pair.privateKey);
            return pair.publicKey;
          },
        },
      ),
    ).toEqual(pair);
  });

  test("force generates even when a public key is already stored", async () => {
    const rotated = {
      privateKey: "NEW PRIVATE",
      publicKey: "ssh-ed25519 BBBB",
    };
    expect(
      await nextComputerSshKeys(
        { privateKey: pair.privateKey, publicKey: pair.publicKey },
        {
          force: true,
          generate: async () => rotated,
          derivePublic: async () => {
            throw new Error("should not derive");
          },
        },
      ),
    ).toEqual(rotated);
  });
});

describe("generateEd25519KeyPair", () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  test("produces a pair ssh-keygen can round-trip", async () => {
    const pair = await generateEd25519KeyPair();
    expect(pair.privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(pair.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
    expect(pair.publicKey).toContain(SSH_KEY_COMMENT);

    const derived = await derivePublicKey(pair.privateKey);
    const storedBody = pair.publicKey.split(" ").slice(0, 2).join(" ");
    const derivedBody = derived.split(" ").slice(0, 2).join(" ");
    expect(derivedBody).toBe(storedBody);
  });

  // Railway's Nixpacks Bun image has no openssh-client, so generation
  // must not depend on `ssh-keygen` being on PATH. Opening Computer and
  // tapping Regenerate both failed there with "Could not generate a key."
  test("mints a pair when ssh-keygen is not on PATH", async () => {
    const empty = await mkdtemp(join(tmpdir(), "no-ssh-keygen-"));
    process.env.PATH = empty;
    try {
      const pair = await generateEd25519KeyPair();
      expect(pair.privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
      expect(pair.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
      expect(pair.publicKey).toContain(SSH_KEY_COMMENT);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  test("derives the public key when ssh-keygen is not on PATH", async () => {
    const pair = await generateEd25519KeyPair();
    const empty = await mkdtemp(join(tmpdir(), "no-ssh-keygen-"));
    process.env.PATH = empty;
    try {
      const derived = await derivePublicKey(pair.privateKey);
      const storedBody = pair.publicKey.split(" ").slice(0, 2).join(" ");
      const derivedBody = derived.split(" ").slice(0, 2).join(" ");
      expect(derivedBody).toBe(storedBody);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
