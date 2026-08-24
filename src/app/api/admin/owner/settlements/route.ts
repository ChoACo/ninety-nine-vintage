import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { decryptAccountNumber } from "@/lib/settlement/payoutAccount.server";

type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

interface SettlementExportBatch {
  accountHolder: string;
  accountNumberMasked: string;
  bankName: string;
  id: string;
  storeId: string;
  storeName: string;
  settlementDate: string;
  cycleCode: string | null;
  payoutAmount: number;
}

function readExportBatches(value: unknown): SettlementExportBatch[] | null {
  if (!record(value) || !Array.isArray(value.batches)) return null;
  const batches: SettlementExportBatch[] = [];
  for (const candidate of value.batches) {
    if (!record(candidate)) return null;
    if (candidate.status !== "draft" || candidate.payoutAmount === 0) continue;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.bankName !== "string" ||
      typeof candidate.accountHolder !== "string" ||
      typeof candidate.accountNumberMasked !== "string" ||
      typeof candidate.storeId !== "string" ||
      typeof candidate.storeName !== "string" ||
      typeof candidate.settlementDate !== "string" ||
      (candidate.cycleCode !== null && typeof candidate.cycleCode !== "string") ||
      typeof candidate.payoutAmount !== "number" ||
      !Number.isSafeInteger(candidate.payoutAmount) ||
      candidate.payoutAmount < 0
    ) {
      return null;
    }
    batches.push({
      bankName: candidate.bankName,
      accountHolder: candidate.accountHolder,
      accountNumberMasked: candidate.accountNumberMasked,
      id: candidate.id,
      storeId: candidate.storeId,
      storeName: candidate.storeName,
      settlementDate: candidate.settlementDate,
      cycleCode: candidate.cycleCode,
      payoutAmount: candidate.payoutAmount,
    });
  }
  return batches;
}

async function exportPendingSettlements(rpc: RpcClient) {
  const deskResult = await rpc.rpc("get_owner_payout_desk");
  if (deskResult.error) {
    return commerceJson({ error: "settlement_export_unavailable" }, 503);
  }
  const batches = readExportBatches(deskResult.data);
  if (!batches) {
    return commerceJson({ error: "settlement_export_unavailable" }, 503);
  }

  const storeIds = [...new Set(batches.map((batch) => batch.storeId))];
  const accountResults = await Promise.all(
    storeIds.map(async (storeId) => ({
      storeId,
      result: await rpc.rpc("reveal_owner_store_payout_account", {
        p_store_id: storeId,
        p_reason: "은행 대량 이체 CSV 다운로드",
      }),
    })),
  );
  const accounts = new Map<string, {
    accountHolder: string;
    accountNumber: string;
    accountNumberMasked: string;
    bankName: string;
  }>();
  for (const { result, storeId } of accountResults) {
    if (result.error || !record(result.data)) {
      return commerceJson({
        error: "settlement_export_account_unavailable",
        message: "승인된 정산 계좌를 확인하지 못한 판매센터가 있습니다.",
      }, result.error?.code === "42501" ? 403 : 422);
    }
    const account = result.data;
    if (
      typeof account.bankName !== "string" ||
      typeof account.accountHolder !== "string" ||
      typeof account.accountNumberMasked !== "string" ||
      typeof account.ciphertext !== "string"
    ) {
      return commerceJson({ error: "settlement_export_account_unavailable" }, 503);
    }
    const snapshotMismatch = batches.some((batch) =>
      batch.storeId === storeId && (
        batch.bankName !== account.bankName ||
        batch.accountHolder !== account.accountHolder ||
        batch.accountNumberMasked !== account.accountNumberMasked
      ),
    );
    if (snapshotMismatch) {
      return commerceJson({
        error: "settlement_export_account_changed",
        message: "정산 배치 생성 후 계좌가 변경된 판매센터가 있습니다. 계좌와 배치를 다시 확인해 주세요.",
      }, 409);
    }
    try {
      accounts.set(storeId, {
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        accountNumberMasked: account.accountNumberMasked,
        accountNumber: decryptAccountNumber(account.ciphertext),
      });
    } catch {
      return commerceJson({ error: "payout_account_decryption_failed" }, 503);
    }
  }

  const rows = batches.map((batch) => {
    const account = accounts.get(batch.storeId);
    return account ? { ...batch, ...account } : null;
  });
  if (rows.some((row) => row === null)) {
    return commerceJson({ error: "settlement_export_account_unavailable" }, 503);
  }
  return commerceJson({ rows });
}

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
  if (body.action === "export") return exportPendingSettlements(rpc);
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
