"use client";

import {
  CheckCircle2,
  ClipboardCopy,
  ReceiptText,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { OwnerBankTransferExportButton } from "@/components/admin/owner/OwnerBankTransferExportButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Batch = {
  id: string;
  storeId: string;
  storeName: string;
  settlementDate: string;
  cycleCode: string | null;
  grossSales: number;
  platformFee: number;
  monthlyStoreFee: number;
  carriedOverFee: number;
  deductedFee: number;
  remainingUnpaidFee: number;
  payoutAmount: number;
  feeRolloverCount: number;
  overdueNoticeSentAt: string | null;
  status: string;
  paidAt: string | null;
  version: number;
  bankName: string | null;
  accountHolder: string | null;
  accountNumberMasked: string | null;
};

type Desk = {
  pendingCount: number;
  pendingAmount: number;
  batches: Batch[];
};

type Dialog = { kind: "reveal" | "complete"; batch: Batch } | null;

const won = (value: number) =>
  `${new Intl.NumberFormat("ko-KR").format(value)}원`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function OwnerPayoutDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const request = useCallback(async (
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>,
  ) => {
    const session = (await getSupabaseBrowserClient().auth.getSession()).data
      .session;
    if (!session) throw new Error("소유자 로그인이 필요합니다.");
    const response = await fetch("/api/admin/owner/settlements", {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isRecord(payload)) {
      const message = isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "정산 요청에 실패했습니다.";
      throw new Error(message);
    }
    return payload;
  }, []);

  const load = useCallback(async () => {
    try {
      setNotice("");
      const payload = await request();
      if (!isRecord(payload.desk)) {
        throw new Error("정산 응답을 확인하지 못했습니다.");
      }
      setDesk(payload.desk as unknown as Desk);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "정산 정보를 불러오지 못했습니다.",
      );
    }
  }, [request]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function copyAccount(batch: Batch) {
    const account = revealed[batch.storeId];
    if (!account) {
      setDialog({ kind: "reveal", batch });
      return;
    }
    try {
      await navigator.clipboard.writeText(
        `${batch.bankName ?? ""} ${account}`.trim(),
      );
      setNotice("계좌번호를 클립보드에 복사했습니다.");
    } catch {
      setNotice("계좌번호를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
    }
  }

  async function submit() {
    if (!dialog || reason.trim().length < 3) return;
    setBusy(true);
    try {
      if (dialog.kind === "reveal") {
        const payload = await request("POST", {
          action: "reveal",
          storeId: dialog.batch.storeId,
          reason,
        });
        const result = isRecord(payload.result) ? payload.result : null;
        if (!result || typeof result.accountNumber !== "string") {
          throw new Error("계좌 원문을 확인하지 못했습니다.");
        }
        const accountNumber = result.accountNumber;
        setRevealed((current) => ({
          ...current,
          [dialog.batch.storeId]: accountNumber,
        }));
        setNotice("감사 기록을 남기고 계좌 원문을 열람했습니다.");
      } else {
        if (!reference.trim()) return;
        await request("POST", {
          action: "complete",
          batchId: dialog.batch.id,
          expectedVersion: dialog.batch.version,
          transferReference: reference,
          reason,
        });
        setNotice("송금 완료 처리와 운영자 알림 기록을 완료했습니다.");
        await load();
      }
      setDialog(null);
      setReason("");
      setReference("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = () => {
    setDialog(null);
    setReason("");
    setReference("");
  };
  const pending = desk?.batches.filter((batch) => batch.status === "draft") ?? [];
  const history = desk?.batches.filter((batch) => batch.status !== "draft") ?? [];

  return (
    <div className="space-y-6 text-zinc-100">
      <header className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <p className="text-xs font-black uppercase tracking-[.18em] text-zinc-500">
          Monday · Thursday payout desk
        </p>
        <h1 className="mt-2 text-3xl font-black">오늘 송금할 판매센터</h1>
        <p className="mt-2 text-xs text-zinc-400">
          정산 기준 오후 6시 · 정산금 송금 처리 오후 6시~오후 9시 (KST)
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Metric label="송금 대기 센터" value={`${desk?.pendingCount ?? 0}곳`} />
          <Metric
            accent
            label="총 송금 예정액"
            value={won(desk?.pendingAmount ?? 0)}
          />
        </div>
        <OwnerBankTransferExportButton disabled={pending.length === 0} />
      </header>

      {notice && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          {notice}
        </p>
      )}

      <section className="space-y-3">
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">
            현재 송금 대기 중인 정산이 없습니다.
          </div>
        ) : (
          pending.map((batch) => (
            <article
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5"
              key={batch.id}
            >
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <p className="text-lg font-black">{batch.storeName}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {batch.cycleCode ?? batch.settlementDate}
                  </p>
                </div>
                <strong className="break-all font-mono text-2xl text-emerald-400">
                  {won(batch.payoutAmount)}
                </strong>
              </div>
              {batch.feeRolloverCount >= 4 && batch.remainingUnpaidFee > 0 && (
                <div className="mt-4 flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                  <TriangleAlert size={16} />
                  입점비 {won(batch.remainingUnpaidFee)}가 {batch.feeRolloverCount}회
                  이월되어 별도 청구 알림이 발송되었습니다.
                </div>
              )}
              <div className="mt-4 min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="break-all text-xs text-zinc-400">
                  {batch.bankName} {revealed[batch.storeId] ?? batch.accountNumberMasked}
                  {" "}(예금주 {batch.accountHolder})
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="min-h-11 rounded-xl border border-zinc-700 px-3 text-xs font-bold"
                    onClick={() => void copyAccount(batch)}
                    type="button"
                  >
                    <ClipboardCopy className="mr-2 inline" size={14} />
                    {revealed[batch.storeId] ? "계좌 복사" : "계좌 원문 열람"}
                  </button>
                  <details className="rounded-xl border border-zinc-700 px-3 py-2 text-xs">
                    <summary className="min-h-6 cursor-pointer font-bold">
                      <ReceiptText className="mr-2 inline" size={14} />
                      명세서 보기
                    </summary>
                    <div className="mt-3 grid gap-1 text-zinc-400">
                      <Line label="총 판매액" value={batch.grossSales} />
                      <Line label="플랫폼 수수료" value={-batch.platformFee} />
                      <Line label="당월 이용료" value={batch.monthlyStoreFee} />
                      <Line label="이월 이용료" value={batch.carriedOverFee} />
                      <Line label="이번 공제액" value={-batch.deductedFee} />
                    </div>
                  </details>
                  <button
                    className="min-h-11 rounded-xl bg-emerald-500 px-4 text-xs font-black text-zinc-950"
                    onClick={() => setDialog({ kind: "complete", batch })}
                    type="button"
                  >
                    <CheckCircle2 className="mr-2 inline" size={15} />
                    정산 지급 완료
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-black">정산 이력</h2>
        <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800 md:hidden">
          {history.map((batch) => (
            <article className="min-w-0 space-y-4 bg-zinc-950 p-4" key={batch.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{batch.storeName}</p>
                  <time className="mt-1 block font-mono text-[10px] text-zinc-500">{batch.settlementDate}</time>
                </div>
                <span className="shrink-0 rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-300">
                  {batch.status === "paid" ? "정산 완료" : "공제 처리"}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 rounded-xl bg-zinc-900 p-3 text-right">
                <div><dt className="text-[10px] text-zinc-500">판매액</dt><dd className="mt-1 break-all font-mono text-xs">{won(batch.grossSales)}</dd></div>
                <div><dt className="text-[10px] text-zinc-500">공제</dt><dd className="mt-1 break-all font-mono text-xs">{won(batch.platformFee + batch.deductedFee)}</dd></div>
                <div><dt className="text-[10px] text-zinc-500">지급액</dt><dd className="mt-1 break-all font-mono text-xs font-bold text-emerald-400">{won(batch.payoutAmount)}</dd></div>
              </dl>
            </article>
          ))}
          {history.length === 0 && <p className="px-4 py-10 text-center text-xs text-zinc-500">아직 완료된 정산 이력이 없습니다.</p>}
        </div>
        <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 md:block">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-500">
              <tr>
                <th className="p-3">정산일</th>
                <th>센터</th>
                <th className="text-right">판매액</th>
                <th className="text-right">공제</th>
                <th className="text-right">지급액</th>
                <th className="px-3">상태</th>
              </tr>
            </thead>
            <tbody>
              {history.map((batch) => (
                <tr className="border-t border-zinc-800" key={batch.id}>
                  <td className="p-3 font-mono">{batch.settlementDate}</td>
                  <td>{batch.storeName}</td>
                  <td className="text-right font-mono">{won(batch.grossSales)}</td>
                  <td className="text-right font-mono">
                    {won(batch.platformFee + batch.deductedFee)}
                  </td>
                  <td className="text-right font-mono text-emerald-400">
                    {won(batch.payoutAmount)}
                  </td>
                  <td className="px-3">
                    {batch.status === "paid" ? "정산 완료" : "공제 처리"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        busy={busy}
        confirmLabel={dialog?.kind === "complete" ? "정산 지급 완료 확정" : "계좌 원문 열람"}
        description={dialog?.kind === "complete"
          ? "실제 입금 후 정산 완료 상태로 전환하는 작업입니다. 완료 처리 후에는 정산 이력과 운영자 알림에 기록됩니다."
          : "열람 사유가 감사 로그에 기록되며 계좌 원문은 이 화면에서만 잠시 표시됩니다."}
        disabled={!dialog || reason.trim().length < 3 ||
          (dialog.kind === "complete" && !reference.trim())}
        onClose={closeDialog}
        onConfirm={() => void submit()}
        open={dialog !== null}
        title={dialog?.kind === "complete"
          ? `${won(dialog.batch.payoutAmount)} 정산 지급 완료 확인`
          : "계좌 원문 열람"}
      >
        {dialog?.kind === "complete" && (
          <input
            className="mt-4 h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm"
            onChange={(event) => setReference(event.target.value)}
            placeholder="송금 참조번호"
            value={reference}
          />
        )}
        <textarea
          className="mt-3 min-h-24 w-full rounded-xl border border-line bg-paper p-3 text-sm"
          onChange={(event) => setReason(event.target.value)}
          placeholder="감사 기록 사유 (3자 이상)"
          value={reason}
        />
      </ConfirmDialog>
    </div>
  );
}

function Metric({
  accent = false,
  label,
  value,
}: Readonly<{
  accent?: boolean;
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-black ${accent ? "text-emerald-400" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function Line({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <p className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono">
        {value < 0 ? "-" : ""}{won(Math.abs(value))}
      </span>
    </p>
  );
}
