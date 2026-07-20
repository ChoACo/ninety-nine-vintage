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
  const { data, error } = await admin
    .from("payment_runtime_settings")
    .select("active_mode, bank_name, account_number")
    .eq("singleton", true)
    .maybeSingle();
  if (error || !data) throw new Error("manual_transfer_settings_unavailable");

  if (
    data.active_mode !== "manual_transfer" ||
    data.bank_name !== account.bankName ||
    data.account_number !== account.accountNumber
  ) {
    const { error: updateError } = await admin
      .from("payment_runtime_settings")
      .update({
        active_mode: "manual_transfer",
        bank_name: account.bankName,
        account_number: account.accountNumber,
      })
      .eq("singleton", true);
    if (updateError) throw new Error("manual_transfer_settings_unavailable");
  }

  return account;
}
