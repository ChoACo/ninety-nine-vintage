import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { decryptAccountNumber } from "@/lib/settlement/payoutAccount.server";

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const { data, error } = await (auth.admin as unknown as RpcClient).rpc(
    "get_owner_store_platform_management",
  );
  if (error) return commerceJson({ error: error.message ?? "platform_management_unavailable" }, 503);
  return commerceJson({ management: data });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string") {
    return commerceJson({ error: "invalid_platform_request" }, 422);
  }
  const rpc = auth.admin as unknown as RpcClient;
  const result = body.action === "save_group"
    ? await rpc.rpc("manage_owner_fulfillment_group", {
      p_group_id: typeof body.groupId === "string" ? body.groupId : null,
      p_name: body.name,
      p_store_ids: body.storeIds,
      p_shipping_charge_mode: body.shippingChargeMode,
      p_group_shipping_fee_amount: body.shippingChargeMode === "per_group" ? body.shippingFeeAmount : null,
      p_representative_store_id: body.shippingChargeMode === "per_group" ? body.representativeStoreId : null,
      p_expected_version: Number.isSafeInteger(body.expectedVersion) ? body.expectedVersion : null,
    })
      : body.action === "approve_plan"
      ? await rpc.rpc("approve_owner_store_service_plan", {
        p_store_id: body.storeId,
        p_plan_code: body.planCode,
        p_start_at: body.startAt,
        p_expected_version: body.expectedVersion,
      })
      : body.action === "reject_plan"
        ? await rpc.rpc("reject_owner_store_service_plan", {
          p_store_id: body.storeId,
          p_reason: body.reason,
          p_expected_version: body.expectedVersion,
        })
      : body.action === "configure_automation"
        ? await rpc.rpc("configure_owner_store_automation", {
          p_store_id: body.storeId,
          p_enabled: body.enabled,
          p_client_id: body.clientId,
          p_version: body.version,
          p_expected_version: body.expectedVersion,
        })
      : body.action === "create_settlements"
        ? await rpc.rpc("create_owner_settlement_batches", {
          p_settlement_date: body.settlementDate,
        })
        : body.action === "approve_payout_account"
          ? await rpc.rpc("approve_owner_store_payout_account", {
            p_store_id: body.storeId,
            p_approved: body.approved,
            p_expected_version: body.expectedVersion,
          })
          : body.action === "complete_settlement"
            ? await rpc.rpc("complete_owner_settlement_batch", {
              p_batch_id: body.batchId,
              p_transfer_reference: body.transferReference,
              p_expected_version: body.expectedVersion,
            })
            : body.action === "reveal_payout_account"
              ? await rpc.rpc("reveal_owner_store_payout_account", {
                p_store_id: body.storeId,
                p_reason: body.reason,
              })
        : null;
  if (!result) return commerceJson({ error: "invalid_platform_action" }, 422);
  if (result.error) {
    const status = result.error.code === "42501" ? 403
      : ["40001", "23505"].includes(result.error.code ?? "") ? 409 : 422;
    return commerceJson({ error: result.error.message ?? "platform_management_failed" }, status);
  }
  if (body.action === "reveal_payout_account" && isRecord(result.data) && typeof result.data.ciphertext === "string") {
    try {
      return commerceJson({ result: { ...result.data, ciphertext: undefined, accountNumber: decryptAccountNumber(result.data.ciphertext) } });
    } catch {
      return commerceJson({ error: "payout_account_decryption_failed" }, 503);
    }
  }
  return commerceJson({ result: result.data });
}
