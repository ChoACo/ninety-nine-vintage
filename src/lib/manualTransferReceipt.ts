export const MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH = 80;
export const MANUAL_TRANSFER_MEMO_MAX_LENGTH = 500;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const STORAGE_PREFIX = "ninety-nine:manual-transfer-receipt:";

interface PendingReceipt {
  fingerprint: string;
  idempotencyKey: string;
}

interface ReceiptFingerprintInput {
  kind: "auction" | "commerce" | "shipping";
  targetId: string;
  amount: number;
  depositorName: unknown;
  memo: unknown;
}

const inMemoryPendingReceipts = new Map<string, PendingReceipt>();

export function canonicalizeManualTransferText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function manualTransferReceiptFingerprint({
  kind,
  targetId,
  amount,
  depositorName,
  memo,
}: ReceiptFingerprintInput) {
  const canonicalPayload = JSON.stringify({
    kind,
    targetId,
    amount,
    depositorName: canonicalizeManualTransferText(
      depositorName,
      MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH,
    ),
    memo: canonicalizeManualTransferText(
      memo,
      MANUAL_TRANSFER_MEMO_MAX_LENGTH,
    ),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPayload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function storageKey(actorId: string, scope: string) {
  if (!actorId || !scope) {
    throw new Error("Manual-transfer receipt scope requires an authenticated actor.");
  }
  return `${STORAGE_PREFIX}${actorId}:${scope}`;
}

function readStoredReceipt(key: string): PendingReceipt | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingReceipt>;
    if (
      typeof parsed.fingerprint !== "string" ||
      !FINGERPRINT_PATTERN.test(parsed.fingerprint) ||
      typeof parsed.idempotencyKey !== "string" ||
      !UUID_V4_PATTERN.test(parsed.idempotencyKey)
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return {
      fingerprint: parsed.fingerprint,
      idempotencyKey: parsed.idempotencyKey,
    };
  } catch {
    return null;
  }
}

function writeStoredReceipt(key: string, pending: PendingReceipt) {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(key, JSON.stringify(pending));
    }
  } catch {
    // The in-memory copy still protects retries during the current mount.
  }
}

export function getOrCreatePendingManualTransferReceipt(
  actorId: string,
  scope: string,
  fingerprint: string,
) {
  const key = storageKey(actorId, scope);
  const pending = inMemoryPendingReceipts.get(key) ?? readStoredReceipt(key);
  if (pending?.fingerprint === fingerprint) {
    inMemoryPendingReceipts.set(key, pending);
    return pending.idempotencyKey;
  }

  const next = { fingerprint, idempotencyKey: crypto.randomUUID() };
  inMemoryPendingReceipts.set(key, next);
  writeStoredReceipt(key, next);
  return next.idempotencyKey;
}

export function clearPendingManualTransferReceipt(
  actorId: string,
  scope: string,
  fingerprint: string,
) {
  const key = storageKey(actorId, scope);
  const pending = inMemoryPendingReceipts.get(key) ?? readStoredReceipt(key);
  if (pending?.fingerprint !== fingerprint) return;
  inMemoryPendingReceipts.delete(key);
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // The persisted value expires with the browser tab and cannot bypass the
    // server-side actor/key/payload contract.
  }
}
