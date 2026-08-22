"use client";

import { KeyRound, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { PremiumDialog } from "@/components/ui/PremiumDialog";
import {
  hasOwnerMemberAccessMarker,
  OWNER_RETURN_CONFIRMATION,
} from "@/lib/ownerMemberAccess";
import { isProductionTestMember } from "@/lib/productionTestMember";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ReturnStep = "summary" | "reauth";

export function OwnerReturnControl() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ReturnStep>("summary");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void getSupabaseBrowserClient().auth.getUser().then(({ data }) => {
      if (active) {
        setAvailable(
          hasOwnerMemberAccessMarker() && isProductionTestMember(data.user),
        );
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function close() {
    if (busy) return;
    setOpen(false);
    setStep("summary");
    setConfirmation("");
    setNotice("");
  }

  async function returnToOwner() {
    if (busy || confirmation.trim() !== OWNER_RETURN_CONFIRMATION) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut({
        scope: "local",
      });
      if (error) throw error;
      const returnTo = "/admin/owner?memberAccessReturn=1";
      window.location.assign(
        `/api/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`,
      );
    } catch {
      setNotice("회원 세션을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <>
      <aside className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] border border-sky-200 bg-paper p-4 shadow-2xl shadow-black/15">
        <p className="flex items-center gap-2 text-xs font-black"><ShieldCheck size={15} /> 일반 회원 검증 세션</p>
        <p className="mt-2 text-[11px] leading-5 text-muted">현재 탭은 실제 테스트 회원 권한입니다. 소유자 권한은 활성화되어 있지 않습니다.</p>
        <button className="mt-3 flex h-10 w-full items-center justify-center gap-2 bg-ink text-xs font-black text-paper" onClick={() => setOpen(true)} type="button"><RotateCcw size={14} /> 소유자 권한으로 복귀</button>
      </aside>
      <PremiumDialog closeDisabled={busy} labelledBy="owner-return-title" onClose={close} open={open} panelClassName="max-w-lg">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="eyebrow text-muted">{step === "summary" ? "1 / 2 · 세션 종료" : "2 / 2 · 소유자 재인증"}</p>
            <h2 className="mt-2 text-xl font-black" id="owner-return-title">소유자 권한으로 복귀</h2>
          </div>
          <button aria-label="소유자 복귀 창 닫기" className="p-2" disabled={busy} onClick={close} type="button"><X size={18} /></button>
        </div>
        <div className="p-5">
          {step === "summary" ? (
            <>
              <div className="grid gap-3 text-xs leading-5">
                <p className="border border-line p-4"><strong>현재:</strong> 테스트 일반 회원의 실제 주문·배송·채팅·환불 권한</p>
                <p className="border border-line p-4"><strong>복귀:</strong> 회원 세션 종료 → Kakao 로그인 → 서버의 소유자·0등급 확인</p>
              </div>
              <button className="mt-5 h-11 w-full bg-ink text-xs font-black text-paper" onClick={() => setStep("reauth")} type="button">재인증 단계로 이동</button>
            </>
          ) : (
            <>
              <div className="flex gap-3 border border-sky-200 bg-sky-50 p-4 text-xs leading-5"><KeyRound className="mt-0.5 shrink-0 text-sky-800" size={18} /><p>아래 문구를 입력한 뒤 Kakao에서 반드시 소유자 계정을 선택하세요. 다른 회원으로 로그인하면 소유자센터 접근은 서버에서 거부됩니다.</p></div>
              <label className="mt-5 grid gap-2 text-xs font-black">확인 문구: {OWNER_RETURN_CONFIRMATION}<input autoComplete="off" className="h-11 border border-line px-3 font-normal" onChange={(event) => setConfirmation(event.target.value)} value={confirmation} /></label>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button className="h-11 border border-line text-xs font-bold" disabled={busy} onClick={() => setStep("summary")} type="button">이전</button>
                <button className="h-11 bg-kakao text-xs font-black text-kakao-foreground disabled:opacity-40" disabled={busy || confirmation.trim() !== OWNER_RETURN_CONFIRMATION} onClick={() => void returnToOwner()} type="button">{busy ? "이동 중…" : "Kakao 재인증"}</button>
              </div>
            </>
          )}
          {notice && <p aria-live="polite" className="mt-4 text-xs text-red-700">{notice}</p>}
        </div>
      </PremiumDialog>
    </>
  );
}
