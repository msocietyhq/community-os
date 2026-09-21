import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function parseKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Encryption key must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/** Encrypts a UTF-8 string with AES-256-GCM. `hexKey` is a 64-char hex string. */
export function encrypt(plaintext: string, hexKey: string): EncryptedPayload {
  const key = parseKey(hexKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Reverses `encrypt`. Throws if `hexKey` is wrong or the payload was tampered with. */
export function decrypt(payload: EncryptedPayload, hexKey: string): string {
  const key = parseKey(hexKey);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
