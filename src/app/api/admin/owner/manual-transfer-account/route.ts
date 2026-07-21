import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

interface SettingsRow {
  active_mode?: unknown;
  bank_name?: unknown;
  account_number?: unknown;
  configured?: unknown;
  updated_at?: unknown;
}

function firstRow(value: unknown): SettingsRow | null {
  if (Array.isArray(value)) return (value[0] as SettingsRow | undefined) ?? null;
  return value && typeof value === "object" ? value as SettingsRow : null;
}

function payload(row: SettingsRow | null) {
  return {
    activeMode: row?.active_mode === "manual_transfer" ? "manual_transfer" : null,
    bankName: typeof row?.bank_name === "string" ? row.bank_name : "",
    accountNumber: typeof row?.account_number === "string" ? row.account_number : "",
    configured: row?.configured === true,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const { data, error } = await access.userClient.rpc("get_manual_transfer_settings");
    if (error) return ownerAccessJsonResponse({ error: "manual_transfer_account_unavailable" }, 503);
    return ownerAccessJsonResponse(payload(firstRow(data)));
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const bankName = typeof body.bankName === "string" ? body.bankName.trim() : "";
    const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
    if (
      bankName.length < 2 || bankName.length > 40 ||
      accountNumber.length < 5 || accountNumber.length > 50 ||
      !/^[0-9 -]+$/.test(accountNumber)
    ) {
      return ownerAccessJsonResponse({ error: "invalid_bank_account" }, 400);
    }
    const { data, error } = await access.userClient.rpc(
      "update_manual_transfer_settings",
      { p_bank_name: bankName, p_account_number: accountNumber },
    );
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
      return ownerAccessJsonResponse({ error: "manual_transfer_account_update_failed" }, status);
    }
    return ownerAccessJsonResponse(payload(firstRow(data)));
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
