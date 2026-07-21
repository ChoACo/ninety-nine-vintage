import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export interface ManualTransferAccount {
  bankName: string;
  accountNumber: string;
  updatedAt: string | null;
}

interface ManualTransferAccountRow {
  bank_name?: unknown;
  account_number?: unknown;
  updated_at?: unknown;
}

function firstRow(value: unknown): ManualTransferAccountRow | null {
  if (Array.isArray(value)) {
    return (value[0] as ManualTransferAccountRow | undefined) ?? null;
  }
  return value && typeof value === "object"
    ? (value as ManualTransferAccountRow)
    : null;
}

/**
 * The owner-managed database setting is the source of truth. Direct table
 * access remains revoked; the server can only read through a narrow RPC.
 */
export async function getManualTransferAccount(
  admin: SupabaseClient<Database>,
): Promise<ManualTransferAccount> {
  const { data, error } = await admin.rpc(
    "get_manual_transfer_account_for_service",
  );
  const row = firstRow(data);
  const bankName = typeof row?.bank_name === "string"
    ? row.bank_name.trim()
    : "";
  const accountNumber = typeof row?.account_number === "string"
    ? row.account_number.trim()
    : "";
  if (
    error ||
    bankName.length < 2 ||
    accountNumber.length < 5 ||
    !/^[0-9 -]+$/.test(accountNumber)
  ) {
    throw new Error("manual_transfer_not_configured");
  }

  return {
    bankName,
    accountNumber,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}
