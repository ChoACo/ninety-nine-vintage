"use client";

import { RotateCcw, Save, Store, Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PostcodeSearchButton } from "@/components/features/account/PostcodeSearchButton";
import { StoreImageUploader } from "@/components/common/StoreImageUploader";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useToastStore } from "@/store/useToastStore";

const BANKS = [
  "국민은행",
  "신한은행",
  "우리은행",
  "하나은행",
  "농협은행",
  "카카오뱅크",
  "토스뱅크",
];
const COURIERS = [
  "CJ대한통운",
  "우체국택배",
  "로젠택배",
  "한진택배",
  "롯데택배",
];
const TAGS = [
  "아메카지",
  "스트릿",
  "워크웨어",
  "밀리터리",
  "디자이너",
  "올드스쿨",
  "스포츠",
  "유러피안",
];
type StoreData = {
  id: string;
  name: string;
  mallInfo: string | null;
  mallImage: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  conceptTags: string[];
  representativeName: string;
  businessRegistrationNumber: string;
  mailOrderRegistrationNumber: string;
  businessPostalCode: string;
  businessAddress: string;
  businessAddressDetail: string;
  defaultCourier: string;
  regularShippingFee: number | null;
  remoteAreaShippingFee: number | null;
  updatedAt: string | null;
  payoutAccount: { bankName: string; accountHolder: string } | null;
  announcementText: string;
  announcementEnabled: boolean;
};
type Form = {
  name: string;
  bio: string;
  logoUrl: string;
  bannerUrl: string;
  conceptTags: string[];
  representativeName: string;
  businessRegistrationNumber: string;
  mailOrderRegistrationNumber: string;
  businessPostalCode: string;
  businessAddress: string;
  businessAddressDetail: string;
  defaultCourier: string;
  regularShippingFee: string;
  remoteAreaShippingFee: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
};
const cls =
  "mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500";
function businessNo(value: string) {
  const d = value.replace(/\D/gu, "").slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 5), d.slice(5)].filter(Boolean).join("-");
}
function initial(s: StoreData): Form {
  return {
    name: s.name,
    bio: s.mallInfo ?? "",
    logoUrl: s.logoUrl ?? "",
    bannerUrl: s.bannerUrl ?? s.mallImage ?? "",
    conceptTags: s.conceptTags ?? [],
    representativeName: s.representativeName ?? "",
    businessRegistrationNumber: businessNo(s.businessRegistrationNumber ?? ""),
    mailOrderRegistrationNumber: s.mailOrderRegistrationNumber ?? "",
    businessPostalCode: s.businessPostalCode ?? "",
    businessAddress: s.businessAddress ?? "",
    businessAddressDetail: s.businessAddressDetail ?? "",
    defaultCourier: s.defaultCourier ?? COURIERS[0],
    regularShippingFee: String(s.regularShippingFee ?? 3500),
    remoteAreaShippingFee: String(s.remoteAreaShippingFee ?? 3000),
    bankName: s.payoutAccount?.bankName ?? BANKS[0],
    accountHolder: s.payoutAccount?.accountHolder ?? "",
    accountNumber: "",
  };
}

export function StoreBrandingCard({
  storeId,
  form,
  set,
}: {
  storeId: string;
  form: Form;
  set: (p: Partial<Form>) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-black">
        <Store size={18} />
        매장 브랜딩 및 소개
      </h2>
      <div className="mt-5 grid gap-5 md:grid-cols-[140px_1fr]">
        <StoreImageUploader
          aspectClassName="aspect-square max-w-[120px]"
          kind="logo"
          label="매장 로고 (1:1)"
          onChange={(logoUrl) => set({ logoUrl })}
          placeholder="로고 이미지 선택"
          storeId={storeId}
          value={form.logoUrl}
          variant="dark"
        />
        <StoreImageUploader
          aspectClassName="aspect-[16/7]"
          kind="banner"
          label="스토어 대표 배너 이미지 (권장 16:7 · 1200×525)"
          onChange={(bannerUrl) => set({ bannerUrl })}
          placeholder="센터 상단에 노출될 대표 배너 이미지를 업로드하세요."
          storeId={storeId}
          value={form.bannerUrl}
          variant="dark"
        />
      </div>
      <label className="mt-5 block text-xs font-bold text-zinc-300">
        매장명{" "}
        <span className="float-right font-mono text-zinc-500">
          {form.name.length}/30
        </span>
        <input
          className={cls}
          maxLength={30}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="mt-4 block text-xs font-bold text-zinc-300">
        매장 소개{" "}
        <span className="float-right font-mono text-zinc-500">
          {form.bio.length}/300
        </span>
        <textarea
          className={`${cls} min-h-[120px] py-3`}
          maxLength={300}
          value={form.bio}
          onChange={(e) => set({ bio: e.target.value })}
        />
      </label>
      <div className="mt-4">
        <p className="text-xs font-bold text-zinc-300">콘셉트 태그</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TAGS.map((tag) => (
            <button
              className={`min-h-9 rounded-full border px-3 text-xs font-bold ${form.conceptTags.includes(tag) ? "border-emerald-500 bg-emerald-500/10 text-emerald-400" : "border-zinc-700 text-zinc-400"}`}
              key={tag}
              onClick={() =>
                set({
                  conceptTags: form.conceptTags.includes(tag)
                    ? form.conceptTags.filter((v) => v !== tag)
                    : [...form.conceptTags, tag].slice(-8),
                })
              }
              type="button"
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StoreBusinessCard({
  form,
  set,
}: {
  form: Form;
  set: (p: Partial<Form>) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 md:p-6">
      <h2 className="font-black">정산 계좌 및 사업자 정보</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Field label="은행">
          <select
            className={cls}
            value={form.bankName}
            onChange={(e) => set({ bankName: e.target.value })}
          >
            {BANKS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="계좌번호">
          <input
            className={`${cls} font-mono`}
            inputMode="numeric"
            placeholder="하이픈 제외 숫자만 입력"
            value={form.accountNumber}
            onChange={(e) =>
              set({ accountNumber: e.target.value.replace(/\D/gu, "") })
            }
          />
        </Field>
        <Field label="예금주명">
          <input
            className={cls}
            value={form.accountHolder}
            onChange={(e) => set({ accountHolder: e.target.value })}
          />
        </Field>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        계좌번호를 비워 두면 기존 승인 상태가 유지됩니다. 새 번호는 암호화되어
        승인 대기로 제출됩니다.
      </p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Field label="대표자명">
          <input
            className={cls}
            value={form.representativeName}
            onChange={(e) => set({ representativeName: e.target.value })}
          />
        </Field>
        <Field label="사업자등록번호">
          <input
            className={`${cls} font-mono`}
            inputMode="numeric"
            placeholder="000-00-00000"
            value={form.businessRegistrationNumber}
            onChange={(e) =>
              set({ businessRegistrationNumber: businessNo(e.target.value) })
            }
          />
        </Field>
        <Field label="통신판매업신고번호">
          <input
            className={cls}
            placeholder="제 2026-부산0000호"
            value={form.mailOrderRegistrationNumber}
            onChange={(e) =>
              set({ mailOrderRegistrationNumber: e.target.value })
            }
          />
        </Field>
        <Field label="사업장 소재지">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              className={cls}
              readOnly
              value={form.businessPostalCode}
              placeholder="우편번호"
            />
            <PostcodeSearchButton
              onSelect={({ postalCode, address }) =>
                set({
                  businessPostalCode: postalCode,
                  businessAddress: address,
                })
              }
            />
          </div>
        </Field>
        <input
          aria-label="사업장 기본 주소"
          className={`${cls} md:col-span-2`}
          readOnly
          value={form.businessAddress}
          placeholder="주소 검색으로 입력"
        />
        <input
          aria-label="사업장 상세 주소"
          className={`${cls} md:col-span-2`}
          value={form.businessAddressDetail}
          onChange={(e) => set({ businessAddressDetail: e.target.value })}
          placeholder="상세 주소"
        />
      </div>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-bold text-zinc-300">
      {label}
      {children}
    </label>
  );
}

export function StoreShippingPolicyCard({
  form,
  set,
}: {
  form: Form;
  set: (p: Partial<Form>) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 md:p-6">
      <h2 className="flex items-center gap-2 font-black">
        <Truck size={18} />
        보관 및 배송 정책 설정
      </h2>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <Field label="기본 택배사">
          <select
            className={cls}
            value={form.defaultCourier}
            onChange={(e) => set({ defaultCourier: e.target.value })}
          >
            {COURIERS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Money
          label="기본 배송비"
          value={form.regularShippingFee}
          onChange={(regularShippingFee) => set({ regularShippingFee })}
        />
        <Money
          label="제주·도서산간 추가비"
          value={form.remoteAreaShippingFee}
          onChange={(remoteAreaShippingFee) => set({ remoteAreaShippingFee })}
        />
      </div>
      <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-300">
        📦 나인티나인 14일 무료 보관함 자동 적용 매장
      </div>
    </section>
  );
}
function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="mt-2 flex min-h-11 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">
        <span className="grid place-items-center px-3 text-zinc-500">₩</span>
        <input
          className="min-w-0 flex-1 bg-transparent font-mono outline-none"
          inputMode="numeric"
          value={value}
          onChange={(e) =>
            onChange(e.target.value.replace(/\D/gu, "").slice(0, 9))
          }
        />
        <span className="grid place-items-center px-3 text-xs text-zinc-500">
          원
        </span>
      </div>
    </Field>
  );
}

function Settings({
  store,
  token,
  reload,
}: {
  store: StoreData;
  token: string;
  reload: () => Promise<void>;
}) {
  const [form, setForm] = useState(() => initial(store));
  const [busy, setBusy] = useState(false);
  const [announcementText, setAnnouncementText] = useState(store.announcementText ?? "");
  const [announcementEnabled, setAnnouncementEnabled] = useState(store.announcementEnabled ?? false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const toast = useToastStore((s) => s.pushToast);
  const set = (p: Partial<Form>) => setForm((v) => ({ ...v, ...p }));
  const valid =
    form.name.trim() &&
    form.representativeName.trim() &&
    form.businessRegistrationNumber.replace(/\D/gu, "").length === 10;
  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/operator/platform", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "save_settings",
          storeId: store.id,
          ...form,
          businessRegistrationNumber: form.businessRegistrationNumber.replace(
            /\D/gu,
            "",
          ),
          regularShippingFee: Number(form.regularShippingFee),
          remoteAreaShippingFee: Number(form.remoteAreaShippingFee),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "저장 실패");
      toast("success", "매장 설정이 성공적으로 저장되었습니다.");
      await reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function saveNotice() {
    if (noticeBusy) return;
    setNoticeBusy(true);
    try {
      const response = await fetch("/api/admin/operator/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "save_notice", storeId: store.id, announcementText, announcementEnabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "공지 저장 실패");
      toast("success", "매장 공지가 저장되었습니다.");
      await reload();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "공지 저장에 실패했습니다.");
    } finally {
      setNoticeBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <StoreBrandingCard form={form} set={set} storeId={store.id} />
      <section className="w-full max-w-full overflow-hidden break-keep rounded-2xl border border-zinc-800 bg-zinc-900 p-5 md:p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-black">매장 공지</h2><p className="mt-1 text-xs text-zinc-500">한 줄 배너를 편집하고 모바일 노출을 미리 확인합니다.</p></div><label className="grid min-h-11 min-w-11 cursor-pointer place-items-center"><input checked={announcementEnabled} className="size-5 accent-emerald-500" onChange={(event) => setAnnouncementEnabled(event.target.checked)} type="checkbox" /><span className="sr-only">매장 공지 표시</span></label></div>
        <input className={`${cls} text-base md:text-sm`} maxLength={80} onChange={(event) => setAnnouncementText(event.target.value)} placeholder="오늘의 입고 및 배송 공지를 입력하세요" value={announcementText} />
        <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 p-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-zinc-500">Mobile preview</p><div className={`mt-2 rounded-xl px-4 py-3 text-center text-xs font-bold ${announcementEnabled && announcementText.trim() ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>{announcementEnabled && announcementText.trim() ? announcementText : "공지 배너 미노출"}</div></div>
        <button className="mt-4 min-h-11 w-full rounded-xl border border-emerald-500/50 px-4 text-xs font-black text-emerald-400 disabled:opacity-40 sm:w-auto" disabled={noticeBusy || (announcementEnabled && !announcementText.trim())} onClick={() => void saveNotice()} type="button">{noticeBusy ? "공지 저장 중…" : "공지 저장"}</button>
      </section>
      <StoreBusinessCard form={form} set={set} />
      <StoreShippingPolicyCard form={form} set={set} />
      <footer className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-3 pb-[calc(env(safe-area-inset-bottom,16px)+0.75rem)] shadow-2xl backdrop-blur md:pb-3">
        <p className="text-xs text-zinc-500">
          마지막 설정 변경 일시:{" "}
          {store.updatedAt
            ? new Date(store.updatedAt).toLocaleString("ko-KR")
            : "기록 없음"}
        </p>
        <div className="flex gap-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
            onClick={() => setForm(initial(store))}
            type="button"
          >
            <RotateCcw size={15} />
            취소 / 되돌리기
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black text-zinc-950 disabled:opacity-40"
            disabled={!valid || busy}
            onClick={() => void save()}
            type="button"
          >
            <Save size={15} />
            {busy ? "저장 중…" : "변경사항 저장"}
          </button>
        </div>
      </footer>
    </div>
  );
}

export function StoreSettingsWorkspace() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [stores, setStores] = useState<StoreData[]>([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/admin/operator/platform", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const p = (await r.json()) as {
        error?: string;
        message?: string;
        management?: { stores?: StoreData[] };
        warnings?: string[];
      };
      if (!r.ok) {
        setError(
          p.message ?? "매장 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
        setStores([]);
        setWarnings([]);
        return;
      }
      setStores(p.management?.stores ?? []);
      setWarnings(p.warnings ?? []);
      setError("");
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
      setStores([]);
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 overflow-hidden break-keep pb-24 text-zinc-100">
      <header>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-400">
          Store settings
        </p>
        <h1 className="mt-2 text-2xl font-black">매장 설정</h1>
        <p className="mt-2 text-sm text-zinc-400">
          고객에게 보이는 브랜딩부터 정산·배송 정책까지 한 곳에서 관리합니다.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          이용 플랜은 기본 3만원 또는 프리미엄 5만원이며, 다음 청구일 전 변경·해지를 요청할 수 있습니다.
        </p>
      </header>
      {loading ? (
        <div aria-label="매장 설정 불러오는 중" className="space-y-4" role="status">
          <div className="h-40 animate-pulse rounded-2xl bg-zinc-900" />
          <div className="h-64 animate-pulse rounded-2xl bg-zinc-900" />
          <span className="sr-only">매장 설정을 불러오는 중입니다.</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          <p>{error}</p>
          <button
            className="mt-3 min-h-11 rounded-xl border border-rose-300/40 px-4 text-xs font-bold hover:bg-rose-500/10"
            onClick={() => void load()}
            type="button"
          >
            다시 시도
          </button>
        </div>
      ) : null}
      {!loading && !error && warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-5 text-amber-200" role="status">
          {warnings.join(" ")}
        </div>
      ) : null}
      {!loading && !error && stores.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-400">
          연결된 운영 매장이 없습니다. 소유자에게 매장 배정을 요청해 주세요.
        </div>
      ) : null}
      {!loading && !error ? stores.map((store) => (
        <Settings
          key={store.id}
          reload={load}
          store={store}
          token={token ?? ""}
        />
      )) : null}
    </div>
  );
}
