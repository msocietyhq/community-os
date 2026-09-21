import { describe, expect, test } from "bun:test";
import {
  decrypt,
  encrypt,
  generateAgentKeyToken,
  generateProjectBootstrapToken,
  hashAgentKeyToken,
  safeCompare,
} from "./crypto";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("encrypt/decrypt", () => {
  test("round-trips a plaintext value", () => {
    const payload = encrypt("postgresql://user:pass@host/db", KEY_A);
    expect(decrypt(payload, KEY_A)).toBe("postgresql://user:pass@host/db");
  });

  test("two encryptions of the same plaintext produce different ciphertext", () => {
    // Each call draws a fresh random IV — reused IVs are what break AES-GCM.
    const a = encrypt("same-value", KEY_A);
    const b = encrypt("same-value", KEY_A);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  test("decrypting with the wrong key throws", () => {
    const payload = encrypt("secret-value", KEY_A);
    expect(() => decrypt(payload, KEY_B)).toThrow();
  });

  test("a tampered ciphertext fails authentication", () => {
    const payload = encrypt("secret-value", KEY_A);
    const tampered = {
      ...payload,
      ciphertext: Buffer.from("tampered-bytes!!").toString("base64"),
    };
    expect(() => decrypt(tampered, KEY_A)).toThrow();
  });

  test("rejects a key that isn't 32 bytes", () => {
    expect(() => encrypt("value", "not-a-valid-key")).toThrow();
  });
});

describe("generateAgentKeyToken/hashAgentKeyToken", () => {
  test("generates unique tokens", () => {
    expect(generateAgentKeyToken()).not.toBe(generateAgentKeyToken());
  });

  test("hash is deterministic for the same token", () => {
    const token = generateAgentKeyToken();
    expect(hashAgentKeyToken(token)).toBe(hashAgentKeyToken(token));
  });

  test("different tokens hash differently", () => {
    expect(hashAgentKeyToken(generateAgentKeyToken())).not.toBe(
      hashAgentKeyToken(generateAgentKeyToken()),
    );
  });

  test("the raw token is never reconstructable from the hash's shape", () => {
    const hash = hashAgentKeyToken(generateAgentKeyToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateProjectBootstrapToken", () => {
  test("is prefixed distinctly from an agent key token", () => {
    expect(generateProjectBootstrapToken()).toMatch(/^projboot_/);
    expect(generateAgentKeyToken()).toMatch(/^devenv_/);
  });
});

describe("safeCompare", () => {
  test("matches equal strings", () => {
    expect(safeCompare("shared-secret", "shared-secret")).toBe(true);
  });

  test("rejects differing strings", () => {
    expect(safeCompare("shared-secret", "wrong-value")).toBe(false);
  });

  test("rejects differing lengths without throwing", () => {
    expect(safeCompare("short", "much-longer-value")).toBe(false);
  });
});
