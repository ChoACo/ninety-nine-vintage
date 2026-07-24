import { MessageCircleMore, ShieldCheck } from "lucide-react";
import { canUseLocalTestAccounts } from "@/lib/localTestAccounts/config";
import { GuestBrowseAction } from "./GuestBrowseAction";
import { LocalTestAccountActions } from "./LocalTestAccountActions";

export function LoginPrompt({
  dismissToPrevious = false,
  returnTo = "/account",
  surface = "desktop",
}: {
  dismissToPrevious?: boolean;
  returnTo?: string;
  surface?: "desktop" | "mobile";
}) {
  const loginHref = `/api/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`;
  const enableLocalTestAccounts = canUseLocalTestAccounts();
  return (
    <section className={`mx-auto w-full max-w-lg rounded-3xl border border-white/10 bg-paper text-center shadow-xl shadow-black/5 ${surface === "desktop" ? "p-10" : "p-6"}`}>
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#FEE500] text-ink shadow-lg shadow-black/10"><MessageCircleMore size={25} /></div>
      <p className="mt-6 text-[10px] font-bold tracking-[0.14em] text-muted">안전한 회원 로그인</p>
      <h1 className="mt-3 text-3xl font-black leading-snug tracking-tight">카카오로 계속하기</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">찜, 장바구니, 실시간 입찰과 주문 내역은 본인 확인 후 안전하게 저장됩니다.</p>
      <a className="mt-8 flex h-13 w-full items-center justify-center rounded-2xl bg-[#FEE500] text-sm font-bold text-[#191919] shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl active:scale-95" href={loginHref}>카카오 로그인</a>
      <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-muted"><ShieldCheck size={14} /> 로그인 후 요청한 화면으로 돌아갑니다.</div>
      {enableLocalTestAccounts && <LocalTestAccountActions returnTo={returnTo} />}
      <GuestBrowseAction
        basePath={surface === "mobile" ? "/m" : ""}
        dismissToPrevious={dismissToPrevious}
      />
    </section>
  );
}
