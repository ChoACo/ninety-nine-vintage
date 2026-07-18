"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/src/components/common";
import { useSupabaseProducts } from "@/src/hooks/useSupabaseProducts";
import {
  beginOwnerHiddenTestManualTransfer,
  deleteOwnerHiddenTestAddress,
  fetchOwnerHiddenTestMember,
  markOwnerHiddenTestShippingShipped,
  requestOwnerHiddenTestShipping,
  setOwnerHiddenTestShippingCredits,
  updateOwnerHiddenTestProfile,
  upsertOwnerHiddenTestAddress,
  type OwnerHiddenTestManualTransfer,
  type OwnerHiddenTestMember,
} from "@/src/lib/ownerAccess/client";
import {
  requestProductPayment,
  type ProductPaymentMethod,
} from "@/src/lib/portone/payment";
import { ownerPlaceTestBid } from "@/src/lib/supabase/auctionLifecycle";
import { formatKRW } from "@/src/utils/formatters";

interface HiddenTestAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  isDefault: boolean;
}

interface HiddenTestWonProduct {
  product_id: string;
  title: string;
  image_urls: string[];
  closed_at: string;
  final_bid_amount: number;
  shipping_status: "ready" | "requested" | "shipped";
  shipment_request_id: string | null;
  payment_id: string | null;
  payment_status: "대기중" | "가상계좌발급" | "결제완료";
  requested_method: ProductPaymentMethod | null;
  portone_status: string | null;
  manual_transfer_order_id: string | null;
  manual_transfer_status: "awaiting_manual_transfer" | "confirmed" | null;
  manual_transfer_requested_at: string | null;
  manual_transfer_confirmed_at: string | null;
  is_payment_settled: boolean;
  active_payment_mode: "manual_transfer" | "portone";
}

interface HiddenTestShippingRequest {
  request_id: string;
  status: string;
  courier: string | null;
  tracking_number: string | null;
  requested_at: string;
  shipped_at: string | null;
  product_ids: string[];
}

interface HiddenTestAuditRow {
  audit_id?: number;
  action?: string;
  occurred_at?: string;
}

interface HiddenTestSnapshot {
  member: OwnerHiddenTestMember | null;
  wonProducts: HiddenTestWonProduct[];
  shippingRequests: HiddenTestShippingRequest[];
  audit: HiddenTestAuditRow[];
}

const paymentMethods: Array<{ value: ProductPaymentMethod; label: string }> = [
  { value: "CARD", label: "카드" },
  { value: "EASY_PAY", label: "카카오페이" },
  { value: "VIRTUAL_ACCOUNT", label: "가상계좌" },
];

const emptyAddress = {
  label: "기본 배송지",
  recipientName: "테스트 수령인",
  phone: "010-0000-0000",
  address: "테스트 전용 배송지",
  isDefault: true,
};

function dateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function normalizeMember(value: OwnerHiddenTestMember): OwnerHiddenTestMember {
  return {
    ...value,
    addresses: Array.isArray(value.addresses) ? value.addresses : [],
  };
}

export function OwnerHiddenTestPanel({ accessToken }: { accessToken: string }) {
  const { posts, refreshProducts } = useSupabaseProducts();
  const [snapshot, setSnapshot] = useState<HiddenTestSnapshot | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [credits, setCredits] = useState("0");
  const [addressDraft, setAddressDraft] = useState(emptyAddress);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [bidReason, setBidReason] = useState("전체 서비스 검증을 위한 테스트 입찰");
  const [selectedShippingIds, setSelectedShippingIds] = useState<Set<string>>(new Set());
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<ProductPaymentMethod>("CARD");
  const [revealedManualTransfers, setRevealedManualTransfers] = useState<
    Record<string, OwnerHiddenTestManualTransfer>
  >({});
  const [courier, setCourier] = useState("테스트 택배");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await fetchOwnerHiddenTestMember(accessToken);
      const member = result.member ? normalizeMember(result.member) : null;
      setSnapshot({
        member,
        wonProducts: result.wonProducts as HiddenTestWonProduct[],
        shippingRequests: result.shippingRequests as HiddenTestShippingRequest[],
        audit: result.audit as HiddenTestAuditRow[],
      });
      if (member) {
        setDisplayName(member.display_name);
        setPhone(member.phone ?? "");
        setCredits(String(member.shipping_credit_count));
        const addresses = member.addresses as HiddenTestAddress[];
        setSelectedAddressId((current) =>
          addresses.some((address) => address.id === current)
            ? current
            : (addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? ""),
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "숨김 테스터 정보를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const addresses = (snapshot?.member?.addresses ?? []) as HiddenTestAddress[];
  const shippableProducts = useMemo(
    () =>
      (snapshot?.wonProducts ?? []).filter(
        (product) =>
          product.is_payment_settled &&
          product.shipping_status === "ready",
      ),
    [snapshot?.wonProducts],
  );

  const run = async (key: string, task: () => Promise<string>) => {
    setBusyKey(key);
    setMessage("");
    setError("");
    try {
      setMessage(await task());
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "테스트 작업을 완료하지 못했습니다.",
      );
    } finally {
      setBusyKey("");
    }
  };

  const saveProfile = () =>
    run("profile", async () => {
      await updateOwnerHiddenTestProfile(accessToken, displayName, phone || null);
      await load();
      return "테스터 프로필을 저장하고 감사 기록을 남겼습니다.";
    });

  const saveCredits = () =>
    run("credits", async () => {
      const value = Number(credits);
      if (!Number.isInteger(value) || value < 0 || value > 10_000) {
        throw new Error("택배 가능 횟수를 0~10,000의 정수로 입력해 주세요.");
      }
      await setOwnerHiddenTestShippingCredits(accessToken, value);
      await load();
      return "테스터의 택배 가능 횟수를 저장했습니다.";
    });

  const saveAddress = () =>
    run("address", async () => {
      await upsertOwnerHiddenTestAddress(accessToken, addressDraft);
      await load();
      setAddressDraft(emptyAddress);
      return "테스트 배송지를 저장했습니다.";
    });

  const deleteAddress = (address: HiddenTestAddress) => {
    if (!window.confirm(`‘${address.label}’ 테스트 배송지를 삭제할까요?`)) return;
    void run(`address-delete-${address.id}`, async () => {
      await deleteOwnerHiddenTestAddress(accessToken, address.id);
      await load();
      return "테스트 배송지를 삭제했습니다.";
    });
  };

  const placeBid = () =>
    run("bid", async () => {
      if (!snapshot?.member) throw new Error("활성 숨김 테스터가 없습니다.");
      const amount = Number(bidAmount.replaceAll(",", ""));
      const result = await ownerPlaceTestBid({
        productId: selectedProductId,
        amount,
        testMemberId: snapshot.member.test_user_id,
        reason: bidReason,
      });
      await Promise.all([load(), refreshProducts()]);
      setBidAmount("");
      return `${result.bidderDisplayName} 테스터로 ${formatKRW(result.amount)} 입찰했습니다.`;
    });

  const pay = (product: HiddenTestWonProduct) =>
    run(`payment-${product.product_id}`, async () => {
      if (!snapshot?.member) throw new Error("활성 숨김 테스터가 없습니다.");
      const canReuseAttempt =
        Boolean(product.payment_id) && product.portone_status !== "FAILED";
      const result = await requestProductPayment({
        productId: product.product_id,
        payMethod:
          canReuseAttempt && product.requested_method
            ? product.requested_method
            : paymentMethod,
        paymentId: canReuseAttempt ? product.payment_id : null,
        testMemberId: snapshot.member.test_user_id,
      });
      await load();
      return result.paymentStatus === "결제완료"
        ? "테스터 결제가 완료되었습니다."
        : result.paymentStatus === "가상계좌발급"
          ? "테스터용 가상계좌가 발급되었습니다."
          : "테스터 결제 상태를 동기화했습니다.";
    });

  const beginManualTransfer = (product: HiddenTestWonProduct) =>
    run(`payment-${product.product_id}`, async () => {
      const result = await beginOwnerHiddenTestManualTransfer(
        accessToken,
        product.product_id,
      );
      setRevealedManualTransfers((current) => ({
        ...current,
        [product.product_id]: result.transfer,
      }));
      await load();
      return "테스터 계좌이체를 입금 진행 중으로 등록했습니다. 운영자 페이지의 입금 확인 목록에서 확정할 수 있습니다.";
    });

  const requestShipping = () =>
    run("shipping", async () => {
      const productIds = [...selectedShippingIds].filter((id) =>
        shippableProducts.some((product) => product.product_id === id),
      );
      if (!selectedAddressId) throw new Error("테스트 배송지를 먼저 선택해 주세요.");
      await requestOwnerHiddenTestShipping(accessToken, productIds, selectedAddressId);
      setSelectedShippingIds(new Set());
      await load();
      return "테스터의 택배 접수를 완료했습니다.";
    });

  const markShipped = (requestId: string) =>
    run(`shipped-${requestId}`, async () => {
      if (!courier.trim() || !trackingNumber.trim()) {
        throw new Error("택배사와 송장번호를 입력해 주세요.");
      }
      await markOwnerHiddenTestShippingShipped(
        accessToken,
        requestId,
        courier.trim(),
        trackingNumber.trim(),
      );
      await load();
      return "테스터 배송을 발송 완료로 변경했습니다.";
    });

  if (isLoading) {
    return <section className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-5" role="status"><div className="space-y-2"><span className="commerce-skeleton block h-4 w-44 rounded" /><span className="commerce-skeleton block h-24 rounded-lg" /></div></section>;
  }

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="hidden-test-member-title">
      <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[var(--accent-text)]">ISOLATED SERVICE TESTER</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="hidden-test-member-title" className="text-xl font-black tracking-tight text-[var(--text-strong)] sm:text-2xl">숨김 서비스 테스터</h2>
          <p className="mt-2 max-w-3xl break-keep font-bold leading-7 text-[var(--text-muted)]">
            실제 외래키를 가진 격리 계정으로 입찰·낙찰·결제·보관·배송 흐름을 검증합니다. 로그인 수단은 발급되지 않으며 다른 운영자·회원·온라인 목록에는 표시되지 않습니다.
          </p>
        </div>
        <span className="rounded-full bg-[var(--danger-surface)] px-3 py-1.5 text-xs font-black text-[var(--danger-text)]">총책임자 전용</span>
      </div>

      {!snapshot?.member ? (
        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
          <p className="font-black text-[var(--text-strong)]">활성 숨김 테스터가 아직 없습니다.</p>
          <p className="mt-1 text-sm font-bold text-[var(--text-muted)]">배포 과정에서 보안 난수 계정을 생성한 뒤 이 화면에 자동 연결됩니다.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" open>
            <summary className="cursor-pointer text-lg font-black text-[var(--text-strong)]">테스터 내 정보</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-black text-[var(--text-strong)]">닉네임<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
              <label className="text-sm font-black text-[var(--text-strong)]">연락처<input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
            </div>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <label className="text-sm font-black text-[var(--text-strong)]">택배 가능 횟수<input inputMode="numeric" value={credits} onChange={(event) => setCredits(event.target.value)} className="mt-1 w-36 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" isLoading={busyKey === "credits"} onClick={() => void saveCredits()}>횟수 저장</Button><Button size="sm" isLoading={busyKey === "profile"} onClick={() => void saveProfile()}>프로필 저장</Button></div>
            </div>
          </details>

          <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <summary className="cursor-pointer text-lg font-black text-[var(--text-strong)]">테스트 배송지 {addresses.length}개</summary>
            <div className="mt-4 space-y-2">
              {addresses.map((address) => (
                <div key={address.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                  <p className="min-w-0 break-words text-sm font-bold text-[var(--text-muted)]"><strong className="text-[var(--text-strong)]">{address.label}</strong>{address.isDefault ? " · 기본" : ""}<span className="block">{address.recipientName} · {address.phone} · {address.address}</span></p>
                  <Button size="sm" variant="ghost" isLoading={busyKey === `address-delete-${address.id}`} onClick={() => deleteAddress(address)}>삭제</Button>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-black text-[var(--text-strong)]">배송지 이름<input value={addressDraft.label} onChange={(event) => setAddressDraft((value) => ({ ...value, label: event.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
              <label className="text-sm font-black text-[var(--text-strong)]">받는 분<input value={addressDraft.recipientName} onChange={(event) => setAddressDraft((value) => ({ ...value, recipientName: event.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
              <label className="text-sm font-black text-[var(--text-strong)]">연락처<input value={addressDraft.phone} onChange={(event) => setAddressDraft((value) => ({ ...value, phone: event.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
              <label className="text-sm font-black text-[var(--text-strong)]">주소<input value={addressDraft.address} onChange={(event) => setAddressDraft((value) => ({ ...value, address: event.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
            </div>
            <div className="mt-3 flex justify-end"><Button size="sm" isLoading={busyKey === "address"} onClick={() => void saveAddress()}>배송지 추가</Button></div>
          </details>

          <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" open>
            <summary className="cursor-pointer text-lg font-black text-[var(--text-strong)]">입찰 테스트</summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <label className="text-sm font-black text-[var(--text-strong)]">진행 상품<select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold"><option value="">상품 선택</option>{posts.map((post) => <option key={post.id} value={post.id}>{post.title} · {formatKRW(post.currentPrice)}</option>)}</select></label>
              <label className="text-sm font-black text-[var(--text-strong)]">입찰 금액<input inputMode="numeric" value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} placeholder="원 단위" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
              <label className="text-sm font-black text-[var(--text-strong)]">테스트 사유<input value={bidReason} onChange={(event) => setBidReason(event.target.value)} maxLength={500} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold" /></label>
            </div>
            <div className="mt-3 flex justify-end"><Button isLoading={busyKey === "bid"} disabled={!selectedProductId || !bidAmount || bidReason.trim().length < 2} onClick={() => void placeBid()}>숨김 테스터로 입찰</Button></div>
          </details>

          <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" open>
            <summary className="cursor-pointer text-lg font-black text-[var(--text-strong)]">낙찰·결제·보관 테스트 {snapshot.wonProducts.length}건</summary>
            {snapshot.wonProducts.some(
              (product) => product.active_payment_mode === "portone",
            ) ? (
              <fieldset className="mt-4 flex flex-wrap gap-2">
                <legend className="mb-2 text-sm font-black text-[var(--text-muted)]">
                  PG 복원 모드 결제 수단
                </legend>
                {paymentMethods.map((method) => (
                  <label key={method.value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-black text-[var(--text-strong)]">
                    <input type="radio" name="hidden-test-payment" value={method.value} checked={paymentMethod === method.value} onChange={() => setPaymentMethod(method.value)} />
                    {method.label}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="mt-4 rounded-xl bg-[var(--info-surface)] px-4 py-3 text-sm font-bold text-[var(--info-text)]">
                현재 수동 계좌이체 모드입니다. 계좌를 확인하면 입금 진행 중으로
                등록되고, 운영자 페이지에서 입금 확정까지 테스트할 수 있습니다.
              </p>
            )}
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {snapshot.wonProducts.length === 0 ? <p className="font-bold text-[var(--text-muted)]">테스터가 낙찰받은 상품이 없습니다. 위 입찰 후 즉시 입찰 종료를 사용해 주세요.</p> : null}
              {snapshot.wonProducts.map((product) => {
                const transfer = revealedManualTransfers[product.product_id];
                return (
                  <article key={product.product_id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <div className="flex min-w-0 gap-3">{product.image_urls?.[0] ? <img src={product.image_urls[0]} alt="" className="size-16 shrink-0 rounded-xl object-cover" /* eslint-disable-line @next/next/no-img-element */ /> : null}<div className="min-w-0"><h3 className="line-clamp-2 font-black text-[var(--text-strong)]">{product.title}</h3><p className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--text-muted)]">{formatKRW(product.final_bid_amount)} · {dateTime(product.closed_at)}</p><p className="mt-1 text-sm font-black text-[var(--accent-text)]">{product.is_payment_settled ? "결제 완료" : product.manual_transfer_requested_at ? "입금 진행 중" : "결제 대기"} · {product.shipping_status === "ready" ? "보관 중" : product.shipping_status === "requested" ? "배송 접수" : "발송 완료"}</p></div></div>
                    {transfer ? (
                      <div className="mt-3 rounded-xl border border-[var(--accent)] bg-[var(--accent-surface)] px-3 py-3 text-sm font-black text-[var(--text-strong)]">
                        {transfer.bank_name} · <span className="select-all">{transfer.account_number}</span>
                        <span className="mt-1 block text-[var(--warning-text)]">{formatKRW(transfer.expected_amount)} 입금 테스트</span>
                      </div>
                    ) : null}
                    {product.is_payment_settled ? (
                      <p className="mt-3 text-sm font-black text-[var(--info-text)]">결제 완료 · 보관함 이동 확인 가능</p>
                    ) : product.active_payment_mode === "manual_transfer" ? (
                      <Button className="mt-3" size="sm" isLoading={busyKey === `payment-${product.product_id}`} onClick={() => void beginManualTransfer(product)}>
                        {product.manual_transfer_requested_at ? "테스트 계좌번호 다시 보기" : "테스트 계좌번호 보기"}
                      </Button>
                    ) : (
                      <Button className="mt-3" size="sm" isLoading={busyKey === `payment-${product.product_id}`} onClick={() => void pay(product)}>테스트 결제창 열기</Button>
                    )}
                  </article>
                );
              })}
            </div>
          </details>

          <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <summary className="cursor-pointer text-lg font-black text-[var(--text-strong)]">택배 접수·발송 테스트</summary>
            <div className="mt-4 grid gap-2">
              {shippableProducts.map((product) => <label key={product.product_id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 font-bold text-[var(--text-strong)]"><input type="checkbox" checked={selectedShippingIds.has(product.product_id)} onChange={() => setSelectedShippingIds((current) => { const next = new Set(current); if (next.has(product.product_id)) next.delete(product.product_id); else next.add(product.product_id); return next; })} />{product.title} · {formatKRW(product.final_bid_amount)}</label>)}
              {shippableProducts.length === 0 ? <p className="font-bold text-[var(--text-muted)]">결제 완료 후 보관 중인 상품이 없습니다.</p> : null}
            </div>
            <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-black text-[var(--text-strong)]">배송지<select value={selectedAddressId} onChange={(event) => setSelectedAddressId(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 font-bold"><option value="">배송지 선택</option>{addresses.map((address) => <option key={address.id} value={address.id}>{address.label} · {address.recipientName}</option>)}</select></label><Button isLoading={busyKey === "shipping"} disabled={selectedShippingIds.size === 0 || !selectedAddressId} onClick={() => void requestShipping()}>선택 상품 택배 접수</Button></div>
            {snapshot.shippingRequests.filter((request) => request.status !== "shipped").length > 0 ? <div className="mt-5 rounded-2xl bg-[var(--surface-muted)] p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-black text-[var(--text-strong)]">택배사<input value={courier} onChange={(event) => setCourier(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-bold" /></label><label className="text-sm font-black text-[var(--text-strong)]">송장번호<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-bold" /></label></div>{snapshot.shippingRequests.filter((request) => request.status !== "shipped").map((request) => <div key={request.request_id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><p className="text-sm font-bold text-[var(--text-muted)]">접수 {dateTime(request.requested_at)} · 상품 {request.product_ids.length}개</p><Button size="sm" variant="secondary" isLoading={busyKey === `shipped-${request.request_id}`} onClick={() => void markShipped(request.request_id)}>발송 완료 처리</Button></div>)}</div> : null}
          </details>

          {snapshot.audit.length > 0 ? <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><summary className="cursor-pointer font-black text-[var(--text-strong)]">테스터 감사 기록 {snapshot.audit.length}건</summary><ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">{snapshot.audit.slice(0, 30).map((row, index) => <li key={row.audit_id ?? index} className="rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-sm font-bold text-[var(--text-muted)]"><strong className="text-[var(--text-strong)]">{row.action ?? "테스트 조작"}</strong> · {dateTime(row.occurred_at)}</li>)}</ul></details> : null}
        </div>
      )}

      {error ? <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-surface)] px-4 py-3 font-bold text-[var(--danger-text)]">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-[var(--info-surface)] px-4 py-3 font-bold text-[var(--info-text)]">{message}</p> : null}
    </section>
  );
}
