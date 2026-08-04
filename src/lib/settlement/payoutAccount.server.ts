import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const secret = process.env.PAYOUT_ACCOUNT_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("PAYOUT_ACCOUNT_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function normalizeAccountNumber(value: string): string {
  const normalized = value.replace(/\s+/gu, "").trim();
  if (!/^[0-9-]{8,40}$/u.test(normalized)) throw new Error("invalid_account_number");
  return normalized;
}

export function maskAccountNumber(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return `${digits.slice(0, 3)}-${"*".repeat(Math.max(4, digits.length - 7))}-${digits.slice(-4)}`;
}

export function encryptAccountNumber(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptAccountNumber(value: string): string {
  const [version,ivText,tagText,ciphertextText]=value.split(".");
  if(version!=="v1"||!ivText||!tagText||!ciphertextText)throw new Error("invalid_ciphertext");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(ivText,"base64url"));
  decipher.setAuthTag(Buffer.from(tagText,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText,"base64url")),decipher.final()]).toString("utf8");
}
