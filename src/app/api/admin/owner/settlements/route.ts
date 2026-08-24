import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { decryptAccountNumber } from "@/lib/settlement/payoutAccount.server";

type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const { data, error } = await (auth.user as unknown as RpcClient).rpc("get_owner_payout_desk");
  if (error) {
    return commerceJson(
      { error: error.message },
      error.code === "42501" ? 403 : 503,
    );
  }
  return commerceJson({ desk: data });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => null);
  if (!record(body) || typeof body.action !== "string") return commerceJson({ error: "invalid_request" }, 422);
  // Owner settlement RPCs intentionally grant EXECUTE only to `authenticated`
  // and authorize with auth.uid(). Preserve the caller JWT instead of using the
  // service-role client, whose auth.uid() is null and whose EXECUTE is revoked.
  const rpc = auth.user as unknown as RpcClient;
  const result = body.action === "complete"
    ? await rpc.rpc("complete_owner_settlement_batch", { p_batch_id: body.batchId, p_transfer_reference: body.transferReference, p_expected_version: body.expectedVersion, p_reason: body.reason })
    : body.action === "reveal"
      ? await rpc.rpc("reveal_owner_store_payout_account", { p_store_id: body.storeId, p_reason: body.reason })
      : body.action === "generate"
        ? await rpc.rpc("create_owner_settlement_batches", { p_settlement_date: body.settlementDate })
        : null;
  if (!result) return commerceJson({ error: "invalid_action" }, 422);
  if (result.error) return commerceJson({ error: result.error.message }, result.error.code === "40001" ? 409 : 422);
  if (body.action === "reveal" && record(result.data) && typeof result.data.ciphertext === "string") {
    try { return commerceJson({ result: { ...result.data, ciphertext: undefined, accountNumber: decryptAccountNumber(result.data.ciphertext) } }); }
    catch { return commerceJson({ error: "payout_account_decryption_failed" }, 503); }
  }
  return commerceJson({ result: result.data });
}
