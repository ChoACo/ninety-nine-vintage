"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface SettlementExportRow {
  id: string;
  storeId: string;
  storeName: string;
  settlementDate: string;
  cycleCode: string | null;
  payoutAmount: number;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  accountNumberMasked: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSettlementExportRow(value: unknown): value is SettlementExportRow {
  return isRecord(value) &&
    Object.keys(value).length === 10 &&
    typeof value.id === "string" &&
    typeof value.storeId === "string" &&
    typeof value.storeName === "string" &&
    typeof value.settlementDate === "string" &&
    (value.cycleCode === null || typeof value.cycleCode === "string") &&
    typeof value.payoutAmount === "number" &&
    Number.isSafeInteger(value.payoutAmount) &&
    value.payoutAmount >= 0 &&
    typeof value.bankName === "string" &&
    typeof value.accountHolder === "string" &&
    typeof value.accountNumber === "string" &&
    typeof value.accountNumberMasked === "string";
}

function csvCell(value: string | number) {
  const text = String(value);
  const guarded = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

function createCsv(rows: SettlementExportRow[]) {
  const headers = [
    "은행명",
    "계좌번호",
    "예금주",
    "이체금액",
    "받는통장표시내용",
    "판매센터",
    "정산일",
    "정산주기",
    "정산배치ID",
    "마스킹계좌",
  ];
  const body = rows.map((row) => [
    row.bankName,
    row.accountNumber,
    row.accountHolder,
    row.payoutAmount,
    `NINETY-NINE ${row.settlementDate}`,
    row.storeName,
    row.settlementDate,
    row.cycleCode ?? "",
    row.id,
    row.accountNumberMasked,
  ]);
  return [headers, ...body]
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
}

export function OwnerBankTransferExportButton({
  disabled,
}: Readonly<{
  disabled: boolean;
}>) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const download = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setNotice("");
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data
        .session;
      if (!session) throw new Error("소유자 로그인이 필요합니다.");
      const response = await fetch("/api/admin/owner/settlements", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "export" }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as unknown;
      const rows = isRecord(payload) && Array.isArray(payload.rows) &&
          payload.rows.every(isSettlementExportRow)
        ? payload.rows
        : null;
      if (!response.ok || !rows) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "은행 이체 자료를 만들지 못했습니다.";
        throw new Error(message);
      }
      if (rows.length === 0) {
        setNotice("다운로드할 송금 대기 정산이 없습니다.");
        return;
      }

      const settlementDates = [...new Set(rows.map((row) => row.settlementDate))];
      const dateLabel = settlementDates.length === 1
        ? settlementDates[0]
        : new Date().toISOString().slice(0, 10);
      const blob = new Blob([`\uFEFF${createCsv(rows)}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ninety-nine-bank-transfer-${dateLabel}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`${rows.length}개 판매센터의 은행 이체 CSV를 다운로드했습니다.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "은행 이체 자료를 만들지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black text-zinc-950 active:scale-[0.98] disabled:opacity-40 sm:w-auto"
        disabled={disabled || busy}
        onClick={() => void download()}
        type="button"
      >
        <Download size={15} />
        {busy ? "이체 파일 생성 중…" : "은행 대량이체 CSV 다운로드"}
      </button>
      <p className="mt-2 text-[10px] leading-4 text-zinc-500">
        승인 계좌만 포함되며 원문 계좌 열람 기록이 판매센터별 감사 로그에 남습니다.
      </p>
      {notice && (
        <p aria-live="polite" className="mt-2 text-xs text-amber-300">
          {notice}
        </p>
      )}
    </div>
  );
}
