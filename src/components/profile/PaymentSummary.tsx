import type { WonAuction } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

interface PaymentSummaryProps {
  auctions: readonly WonAuction[];
}

/**
 * 계좌번호를 받지 않는 요약 컴포넌트입니다.
 * 민감한 계좌는 사용자가 결제/충전 모달을 직접 열었을 때만 렌더링됩니다.
 */
export function PaymentSummary({ auctions }: PaymentSummaryProps) {
  const pendingAuctions = auctions.filter(
    (auction) => auction.stage === "payment-pending",
  );
  const total = pendingAuctions.reduce(
    (sum, auction) => sum + auction.winningBid,
    0,
  );

  return (
    <aside
      aria-labelledby="payment-summary-title"
      className="relative overflow-hidden rounded-[2rem] bg-[#dcebf2] p-5 text-[#354d5b] shadow-[0_18px_50px_rgba(70,103,120,0.12)] sm:p-7"
    >
      <div aria-hidden="true" className="absolute -right-10 -top-12 size-36 rounded-full bg-white/35" />
      <div aria-hidden="true" className="absolute -bottom-12 -left-8 size-28 rounded-full bg-[#f7d8ce]/45" />

      <div className="relative">
        <p className="font-bold tracking-[0.16em] text-[#678294]">PAYMENT GUIDE</p>
        <h2 id="payment-summary-title" className="mt-1 text-2xl font-extrabold">
          입금 대기 요약
        </h2>

        <div className="mt-5 rounded-[1.5rem] bg-white/75 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4 text-[17px] font-bold text-[#607986]">
            <span>입금 대기 상품</span>
            <span>{pendingAuctions.length}건</span>
          </div>
          <div className="my-4 h-px bg-[#c9dce5]" />
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <span className="text-[17px] font-extrabold">상품 금액 합계</span>
            <strong className="text-3xl font-black tracking-tight text-[#c96856]">
              {formatKRW(total)}
            </strong>
          </div>
          <p className="mt-2 text-[17px] font-semibold text-[#68808d]">
            택배비는 일괄 결제창의 선택 여부에 따라 한 번만 합산됩니다.
          </p>
        </div>

        <div className="mt-5 rounded-[1.5rem] border-2 border-white/75 bg-[#f9fcfd]/70 p-5">
          <p className="text-[17px] font-black text-[#405966]">
            🔒 계좌번호는 기본 화면에서 보호됩니다
          </p>
          <p className="mt-2 text-[17px] font-semibold leading-7 text-[#607b89]">
            아래 <strong>[전체 상품 일괄 결제 진행하기]</strong>를 직접 눌렀을 때만
            결제창에서 계좌번호를 확인할 수 있습니다.
          </p>
        </div>
      </div>
    </aside>
  );
}
