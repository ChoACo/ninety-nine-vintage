import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export interface ManualTransferAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

function readRequired(name: "MANUAL_TRANSFER_BANK_NAME" | "MANUAL_TRANSFER_ACCOUNT_NUMBER" | "MANUAL_TRANSFER_ACCOUNT_HOLDER") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("manual_transfer_not_configured");
  return value;
}

export function getManualTransferAccount(): ManualTransferAccount {
  return {
    bankName: readRequired("MANUAL_TRANSFER_BANK_NAME"),
    accountNumber: readRequired("MANUAL_TRANSFER_ACCOUNT_NUMBER"),
    accountHolder: readRequired("MANUAL_TRANSFER_ACCOUNT_HOLDER"),
  };
}

/**
 * The deployment environment is the source of truth. The database copy exists
 * only because legacy settlement RPCs snapshot the account inside their DB
 * transaction; browser code never receives the settings table directly.
 */
export async function syncManualTransferSettings(
  admin: SupabaseClient<Database>,
): Promise<ManualTransferAccount> {
  const account = getManualTransferAccount();
  const { error } = await admin.rpc("sync_manual_transfer_runtime_settings", {
    p_bank_name: account.bankName,
    p_account_number: account.accountNumber,
  });
  if (error) throw new Error("manual_transfer_settings_unavailable");

  return account;
}
