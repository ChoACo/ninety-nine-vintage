"use client";

import { ArrowRight, ShieldAlert, UserRoundCheck, X } from "lucide-react";
import { useState } from "react";

import { PremiumDialog } from "@/components/ui/PremiumDialog";
import {
  clearOwnerMemberAccessMarker,
  storeOwnerMemberAccessMarker,
} from "@/lib/ownerMemberAccess";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Step = "warning" | "confirmation";

export function OwnerMemberAccessPanel() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("warning");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  function close() {
    if (busy) return;
    setOpen(false);
    setStep("warning");
    setConfirmed(false);
    setNotice("");
  }

  async function accessMember() {
    if (busy || !confirmed) return;
    setBusy(true);
    setNotice("");
    try {
      const client = getSupabaseBrowserClient();
      const ownerSession = (await client.auth.getSession()).data.session;
      if (!ownerSession) throw new Error("소유자 로그인이 만료되었습니다.");
      const response = await fetch("/api/admin/owner/member-access", {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerSession.access_token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | { error?: string; session?: { accessToken?: string; refreshToken?: string } }
        | null;
      if (
        !response.ok ||
        !payload?.session?.accessToken ||
        !payload.session.refreshToken
      ) {
        throw new Error(
          response.status === 429
            ? "전환 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
            : "일반 회원 계정으로 전환하지 못했습니다.",
        );
      }
      if (!storeOwnerMemberAccessMarker()) {
        throw new Error("복귀 안내를 이 탭에 저장하지 못했습니다.");
      }
      const { error } = await client.auth.setSession({
        access_token: payload.session.accessToken,
        refresh_token: payload.session.refreshToken,
      });
      if (error) {
        clearOwnerMemberAccessMarker();
        throw error;
      }
      window.location.replace("/account");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "일반 회원 계정으로 전환하지 못했습니다.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <section className="border border-sky-200 bg-sky-50 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="eyebrow text-sky-800">운영 검증 · 실제 회원 세션</p>
            <h2 className="mt-2 text-lg font-black">일반 회원 화면 접속</h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
              고정된 테스트 회원의 실제 Auth 세션으로 전환합니다. 회원의 주문,
              배송, 채팅과 환불 권한은 일반 회원과 동일하게 적용됩니다.
            </p>
          </div>
          <button
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 bg-ink px-5 text-xs font-black text-paper"
            onClick={() => setOpen(true)}
            type="button"
          >
            <UserRoundCheck size={16} /> 회원으로 접속
          </button>
        </div>
      </section>
      <PremiumDialog
        closeDisabled={busy}
        labelledBy="owner-member-access-title"
        onClose={close}
        open={open}
        panelClassName="max-w-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="eyebrow text-muted">
              {step === "warning" ? "1 / 2 · 권한 분리" : "2 / 2 · 최종 확인"}
            </p>
            <h2 className="mt-2 text-xl font-black" id="owner-member-access-title">
              일반 회원으로 전환
            </h2>
          </div>
          <button aria-label="회원 전환 창 닫기" className="p-2" disabled={busy} onClick={close} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          {step === "warning" ? (
            <>
              <div className="flex gap-3 border border-amber-200 bg-amber-500/10 p-4 text-xs leading-5">
                <ShieldAlert className="mt-0.5 shrink-0 text-amber-700" size={18} />
                <p>
                  전환 즉시 이 탭의 소유자 세션은 실제 일반 회원 세션으로 교체됩니다.
                  소유자센터로 돌아오려면 Kakao 소유자 계정을 다시 인증해야 합니다.
                </p>
              </div>
              <button className="mt-5 flex h-11 w-full items-center justify-center gap-2 bg-ink text-xs font-black text-paper" onClick={() => setStep("confirmation")} type="button">
                계속 <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <>
              <label className="flex items-start gap-3 border border-line p-4 text-xs leading-5">
                <input checked={confirmed} className="mt-1" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                <span>소유자 권한이 유지되지 않으며, 복귀 시 재인증이 필요함을 확인했습니다.</span>
              </label>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button className="h-11 border border-line text-xs font-bold" disabled={busy} onClick={() => setStep("warning")} type="button">이전</button>
                <button className="h-11 bg-ink text-xs font-black text-paper disabled:opacity-40" disabled={!confirmed || busy} onClick={() => void accessMember()} type="button">
                  {busy ? "전환 중…" : "실제 회원으로 전환"}
                </button>
              </div>
            </>
          )}
          {notice && <p aria-live="polite" className="mt-4 text-xs text-red-700">{notice}</p>}
        </div>
      </PremiumDialog>
    </>
  );
}
