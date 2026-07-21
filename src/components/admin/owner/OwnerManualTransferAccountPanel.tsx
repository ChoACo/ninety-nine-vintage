"use client";

import { BadgeCheck, Landmark, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AccountPayload {
  bankName?: string;
  accountNumber?: string;
  configured?: boolean;
  updatedAt?: string | null;
  error?: string;
}

const errors: Record<string, string> = {
  invalid_bank_account: "은행명과 계좌번호를 확인해 주세요.",
  manual_transfer_account_unavailable: "입금 계좌를 불러오지 못했습니다.",
  manual_transfer_account_update_failed: "입금 계좌를 저장하지 못했습니다.",
  unauthorized: "소유자 계정으로 다시 로그인해 주세요.",
  forbidden: "소유자만 공용 입금 계좌를 변경할 수 있습니다.",
};

function message(code: string | undefined, fallback: string) {
  return code ? errors[code] ?? fallback : fallback;
}

export function OwnerManualTransferAccountPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [configured, setConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) throw new Error("소유자 계정으로 로그인해 주세요.");
        const response = await fetch("/api/admin/owner/manual-transfer-account", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const data = await response.json() as AccountPayload;
        if (!response.ok) throw new Error(message(data.error, "입금 계좌를 불러오지 못했습니다."));
        if (!active) return;
        setToken(session.access_token);
        setBankName(data.bankName ?? "");
        setAccountNumber(data.accountNumber ?? "");
        setConfigured(data.configured === true);
        setUpdatedAt(data.updatedAt ?? null);
      } catch (error) {
        if (!active) return;
        setFailed(true);
        setNotice(error instanceof Error ? error.message : "입금 계좌를 불러오지 못했습니다.");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (!token || busy) return;
    const bank = bankName.trim();
    const account = accountNumber.trim();
    if (bank.length < 2 || bank.length > 40 || account.length < 5 || account.length > 50 || !/^[0-9 -]+$/.test(account)) {
      setFailed(true);
      setNotice("은행명은 2~40자, 계좌번호는 숫자·공백·하이픈으로 입력해 주세요.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const latest = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!latest?.access_token || latest.access_token !== token) throw new Error("로그인 상태가 변경되었습니다. 다시 확인해 주세요.");
      const response = await fetch("/api/admin/owner/manual-transfer-account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bankName: bank, accountNumber: account }),
      });
      const data = await response.json() as AccountPayload;
      if (!response.ok) throw new Error(message(data.error, "입금 계좌를 저장하지 못했습니다."));
      setBankName(data.bankName ?? bank);
      setAccountNumber(data.accountNumber ?? account);
      setConfigured(data.configured === true);
      setUpdatedAt(data.updatedAt ?? null);
      setFailed(false);
      setNotice("공용 입금 계좌를 저장했습니다.");
    } catch (error) {
      setFailed(true);
      setNotice(error instanceof Error ? error.message : "입금 계좌를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="border border-line bg-surface p-5">
    <div className="flex flex-col gap-3 border-b border-line pb-5">
      <div><p className="eyebrow text-muted">결제 · 공용 계좌</p><h2 className="mt-2 text-xl font-black">수동 계좌이체 설정</h2><p className="mt-2 text-xs leading-5 text-muted">여러 매장의 주문이 이 계좌 하나로 입금됩니다. 변경 내용은 새 입금 안내에 적용되며 기존 주문은 당시 계좌 기록을 유지합니다.</p></div>
      <span className={`inline-flex w-fit items-center gap-2 border px-3 py-2 text-[10px] font-bold ${configured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {configured ? <BadgeCheck size={13} /> : <Landmark size={13} />}{configured ? "결제 가능" : "계좌 설정 필요"}
      </span>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-3">
      <label className="grid gap-2 text-[10px] font-bold">은행명<input autoComplete="off" className="h-11 min-w-0 border border-line bg-paper px-3 text-xs font-normal" disabled={busy} maxLength={40} onChange={(event) => setBankName(event.target.value)} placeholder="예: 국민은행" spellCheck={false} value={bankName} /></label>
      <label className="grid gap-2 text-[10px] font-bold">계좌번호<input autoComplete="off" className="h-11 min-w-0 border border-line bg-paper px-3 font-mono text-xs font-normal" disabled={busy} inputMode="numeric" maxLength={50} onChange={(event) => setAccountNumber(event.target.value)} placeholder="숫자와 하이픈만 입력" spellCheck={false} value={accountNumber} /></label>
      <button className="col-span-2 inline-flex h-11 items-center justify-center justify-self-end gap-2 bg-ink px-5 text-xs font-bold text-paper disabled:opacity-40" disabled={!token || busy} onClick={() => void save()} type="button"><Save size={14} /> {busy ? "확인 중..." : "계좌 저장"}</button>
    </div>
    {notice && <p aria-live="polite" className={`mt-4 text-xs ${failed ? "text-red-700" : "text-emerald-800"}`}>{notice}</p>}
    {updatedAt && <p className="mt-4 text-[10px] text-muted">마지막 변경: {new Date(updatedAt).toLocaleString("ko-KR")}</p>}
  </section>;
}
