import Button from "@/src/components/common/Button";

interface ShippingWalletProps {
  shippingCount: number;
  onRecharge: () => void;
}

export function ShippingWallet({
  shippingCount,
  onRecharge,
}: ShippingWalletProps) {
  return (
    <section
      aria-labelledby="shipping-wallet-title"
      className="mb-6 rounded-2xl border-2 border-[#b7d7e1] bg-[#eaf6fa] px-4 py-3 shadow-[0_10px_26px_rgba(66,117,132,0.09)] sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2
          id="shipping-wallet-title"
          className="text-[19px] font-black text-[#315f6d] sm:text-xl"
        >
          📦 택배 가능 횟수:{" "}
          <strong className="text-[#c86150]">{shippingCount}회</strong>
        </h2>

        <Button
          size="md"
          onClick={onRecharge}
          className="min-h-12 shrink-0 bg-[#4f947d] px-5 text-[17px] shadow-[0_6px_16px_rgba(64,127,105,0.18)] hover:bg-[#43836e]"
        >
          ➕ 택배비만 입금하기
        </Button>
      </div>
    </section>
  );
}
