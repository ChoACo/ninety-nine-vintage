import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

export interface RefundBankAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

export type RefundKind = "item" | "shipping_fee";

export interface EncryptedRefundBankAccount {
  ciphertext: string;
  initializationVector: string;
  authenticationTag: string;
  keyVersion: number;
  fingerprint: string;
  maskedAccountNumber: string;
}

export class RefundEncryptionError extends Error {
  constructor(message = "refund_encryption_unavailable") {
    super(message);
    this.name = "RefundEncryptionError";
  }
}

const ACCOUNT_NUMBER_PATTERN = /^[0-9 -]{5,50}$/;

function normalizedText(value: string, minimum: number, maximum: number) {
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new RefundEncryptionError("invalid_refund_account");
  }
  return normalized;
}

export function normalizeRefundBankAccount(
  value: RefundBankAccount,
): RefundBankAccount {
  const bankName = normalizedText(value.bankName, 2, 40);
  const accountHolder = normalizedText(value.accountHolder, 1, 80);
  const accountNumber = value.accountNumber.trim().replace(/\s+/g, " ");
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    throw new RefundEncryptionError("invalid_refund_account");
  }
  return { bankName, accountNumber, accountHolder };
}

function readEncryptionKeys() {
  const rawKeys = process.env.REFUND_ACCOUNT_ENCRYPTION_KEYS?.trim();
  const activeVersion = Number(
    process.env.REFUND_ACCOUNT_ACTIVE_KEY_VERSION?.trim(),
  );
  if (!rawKeys || !Number.isSafeInteger(activeVersion) || activeVersion < 1) {
    throw new RefundEncryptionError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new RefundEncryptionError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RefundEncryptionError();
  }

  const keys = new Map<number, Buffer>();
  for (const [versionText, encodedKey] of Object.entries(parsed)) {
    const version = Number(versionText);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      typeof encodedKey !== "string"
    ) {
      throw new RefundEncryptionError();
    }
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) throw new RefundEncryptionError();
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw new RefundEncryptionError();
  return { activeVersion, keys };
}

function readFingerprintKey() {
  const encodedKey = process.env.REFUND_ACCOUNT_FINGERPRINT_KEY?.trim();
  if (!encodedKey) throw new RefundEncryptionError();
  const key = Buffer.from(encodedKey, "base64");
  if (key.length < 32) throw new RefundEncryptionError();
  return key;
}

function accountFingerprint(account: RefundBankAccount) {
  return createHmac("sha256", readFingerprintKey())
    .update(account.bankName, "utf8")
    .update("\u0000")
    .update(account.accountNumber.replace(/[ -]/g, ""), "utf8")
    .update("\u0000")
    .update(account.accountHolder, "utf8")
    .digest("hex");
}

function maskedAccountNumber(accountNumber: string) {
  const digits = accountNumber.replace(/\D/g, "");
  const suffix = digits.slice(-4);
  return suffix ? `****${suffix}` : "****";
}

function refundAccountAdditionalData(refundId: string, refundKind: RefundKind) {
  return Buffer.from(
    refundKind === "item"
      ? `manual-refund:${refundId}`
      : `shipping-fee-refund:${refundId}`,
    "utf8",
  );
}

export function encryptRefundBankAccount(
  input: RefundBankAccount,
  refundId: string,
  refundKind: RefundKind = "item",
): EncryptedRefundBankAccount {
  const account = normalizeRefundBankAccount(input);
  const { activeVersion, keys } = readEncryptionKeys();
  const key = keys.get(activeVersion);
  if (!key) throw new RefundEncryptionError();

  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  cipher.setAAD(refundAccountAdditionalData(refundId, refundKind));
  const plaintext = Buffer.from(JSON.stringify(account), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: authenticationTag.toString("base64"),
    keyVersion: activeVersion,
    fingerprint: accountFingerprint(account),
    maskedAccountNumber: maskedAccountNumber(account.accountNumber),
  };
}

export function decryptRefundBankAccount(
  encrypted: Pick<
    EncryptedRefundBankAccount,
    "ciphertext" | "initializationVector" | "authenticationTag" | "keyVersion"
  >,
  refundId: string,
  refundKind: RefundKind = "item",
): RefundBankAccount {
  const { keys } = readEncryptionKeys();
  const key = keys.get(encrypted.keyVersion);
  if (!key) throw new RefundEncryptionError();

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encrypted.initializationVector, "base64"),
    );
    decipher.setAAD(refundAccountAdditionalData(refundId, refundKind));
    decipher.setAuthTag(Buffer.from(encrypted.authenticationTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const value = JSON.parse(plaintext) as Partial<RefundBankAccount>;
    if (
      typeof value.bankName !== "string" ||
      typeof value.accountNumber !== "string" ||
      typeof value.accountHolder !== "string"
    ) {
      throw new RefundEncryptionError();
    }
    return normalizeRefundBankAccount({
      bankName: value.bankName,
      accountNumber: value.accountNumber,
      accountHolder: value.accountHolder,
    });
  } catch (error) {
    if (error instanceof RefundEncryptionError) throw error;
    throw new RefundEncryptionError();
  }
}
