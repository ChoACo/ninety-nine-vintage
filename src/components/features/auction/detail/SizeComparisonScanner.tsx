"use client";

import { Ruler, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormControls";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useGarmentSizeProfile } from "@/hooks/useGarmentSizeProfile";
import type { ItemMeasurements } from "@/types/detail";
import {
  compareGarmentMeasurements,
  countProductMeasurements,
  GARMENT_MEASUREMENT_LABELS,
  parseProductMeasurements,
  type GarmentMeasurementKey,
  type GarmentMeasurements,
  type SavedGarmentProfile,
} from "@/utils/productMeasurements";

const PROFILE_FIELDS: ReadonlyArray<{
  key: GarmentMeasurementKey;
  placeholder: string;
  required: boolean;
}> = [
  { key: "chestWidthCm", placeholder: "예: 54", required: true },
  { key: "totalLengthCm", placeholder: "예: 70", required: true },
  { key: "shoulderWidthCm", placeholder: "예: 47", required: true },
  { key: "sleeveLengthCm", placeholder: "선택", required: false },
];

function structuredMeasurements(value: ItemMeasurements): GarmentMeasurements {
  return {
    chestWidthCm: value.chest > 0 ? value.chest : undefined,
    totalLengthCm: value.length > 0 ? value.length : undefined,
    shoulderWidthCm: value.shoulder > 0 ? value.shoulder : undefined,
    sleeveLengthCm: value.sleeve > 0 ? value.sleeve : undefined,
  };
}

function ProfileEditor({
  onCancel,
  onSave,
  persistsOnDevice,
  profile,
}: {
  onCancel?: () => void;
  onSave: (profile: Omit<SavedGarmentProfile, "updatedAt">) => void;
  persistsOnDevice: boolean;
  profile: SavedGarmentProfile | null;
}) {
  const [values, setValues] = useState<Record<GarmentMeasurementKey, string>>({
    chestWidthCm: profile ? String(profile.chestWidthCm) : "",
    totalLengthCm: profile ? String(profile.totalLengthCm) : "",
    shoulderWidthCm: profile ? String(profile.shoulderWidthCm) : "",
    sleeveLengthCm: profile?.sleeveLengthCm === undefined ? "" : String(profile.sleeveLengthCm),
  });
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      onSave({
        chestWidthCm: Number(values.chestWidthCm),
        totalLengthCm: Number(values.totalLengthCm),
        shoulderWidthCm: Number(values.shoulderWidthCm),
        sleeveLengthCm: values.sleeveLengthCm ? Number(values.sleeveLengthCm) : undefined,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "옷 실측값을 저장하지 못했습니다.");
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        {PROFILE_FIELDS.map((field, index) => (
          <label className="text-[11px] font-bold text-muted" key={field.key}>
            {GARMENT_MEASUREMENT_LABELS[field.key]}
            {field.required && <span className="text-red-700"> *</span>}
            <span className="relative mt-2 block">
              <TextInput
                autoFocus={index === 0}
                className="w-full pr-10 font-mono text-sm font-bold"
                inputMode="decimal"
                max="160"
                min="10"
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                required={field.required}
                step="0.1"
                type="number"
                value={values[field.key]}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">cm</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-[11px] leading-5 text-muted">
        {persistsOnDevice
          ? "이 브라우저에 회원별로만 저장되며 서버나 운영자에게 전송되지 않습니다."
          : "로그인 전에는 현재 브라우저 탭에만 임시 저장되며 서버로 전송되지 않습니다."}
      </p>
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 shadow-sm" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel} type="button" variant="ghost">취소</Button>}
        <Button type="submit" variant="primary">내 옷 실측 저장</Button>
      </div>
    </form>
  );
}

interface SizeComparisonScannerProps {
  itemMeasurements: ItemMeasurements;
  onClose: () => void;
  open: boolean;
  productDescription: string;
  productSize: string;
  productTitle: string;
  userId?: string | null;
}

export function SizeComparisonScanner({
  itemMeasurements,
  onClose,
  open,
  productDescription,
  productSize,
  productTitle,
  userId,
}: SizeComparisonScannerProps) {
  const garment = useGarmentSizeProfile(userId);
  const [editing, setEditing] = useState(false);
  const productMeasurements = useMemo(() => {
    const structured = structuredMeasurements(itemMeasurements);
    const parsed = parseProductMeasurements(productSize, productDescription);
    return { ...parsed, ...Object.fromEntries(Object.entries(structured).filter(([, value]) => value !== undefined)) } as GarmentMeasurements;
  }, [itemMeasurements, productDescription, productSize]);
  const productMeasurementCount = countProductMeasurements(productMeasurements);
  const productMeasurementRows = PROFILE_FIELDS.flatMap(({ key }) => {
    const value = productMeasurements[key];
    return typeof value === "number" && value > 0
      ? [{ key, label: GARMENT_MEASUREMENT_LABELS[key], value }]
      : [];
  });
  const comparisons = garment.profile
    ? compareGarmentMeasurements(productMeasurements, garment.profile)
    : [];

  return (
    <PremiumDialog labelledBy="size-comparison-title" onClose={onClose} open={open} panelClassName="max-w-3xl overflow-y-auto">
        <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted"><Ruler size={13} /> 사이즈 가이드 · 옷과 옷 실측 비교</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.04em]" id="size-comparison-title">사이즈 가이드</h2>
            <p className="mt-2 truncate text-xs text-muted">{productTitle}</p>
          </div>
          <button aria-label="실측 비교 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95" onClick={onClose} type="button"><X size={19} /></button>
        </header>

        <div className="p-6">
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-white/10 bg-surface px-4 py-3 shadow-sm">
            <div><p className="text-[10px] font-bold tracking-[0.12em] text-muted">상품 실측값</p><p className="mt-1 text-sm font-black">잘 맞는 내 옷과 비교하세요.</p></div>
            <span className="rounded-xl border border-line bg-paper px-2 py-1 font-mono text-[10px] font-bold text-muted shadow-sm">상품 실측 {productMeasurementCount}개</span>
          </div>

          {productMeasurementRows.length > 0 && (
            <dl aria-label="상품 실측 사이즈표" className="mb-5 grid grid-cols-2 gap-2">
              {productMeasurementRows.map((measurement) => (
                <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-3 py-3 text-xs shadow-sm" key={measurement.key}>
                  <dt className="text-muted">{measurement.label}</dt>
                  <dd className="font-mono font-bold">{measurement.value.toFixed(1)}cm</dd>
                </div>
              ))}
            </dl>
          )}

          {!garment.hydrated ? (
            <div aria-label="저장된 옷 실측 불러오는 중" className="h-36 animate-pulse bg-surface" />
          ) : !garment.profile || editing ? (
            <ProfileEditor key={garment.profile?.updatedAt ?? "new-profile"} onCancel={garment.profile ? () => setEditing(false) : undefined} onSave={(profile) => { garment.save(profile); setEditing(false); }} persistsOnDevice={garment.persistsOnDevice} profile={garment.profile} />
          ) : productMeasurementCount < 2 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center"><p className="text-sm font-bold">상품 실측 정보 준비 중</p><p className="mt-2 text-xs leading-5 text-muted">실측값이 두 개 이상 등록되면 자동으로 비교합니다.</p></div>
          ) : (
            <div className="space-y-3">
              {comparisons.map((comparison) => (
                <div className="rounded-2xl border border-line bg-paper px-4 py-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg" key={comparison.key}>
                  <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold">{comparison.label}</span><span className="font-mono text-xs font-bold">{comparison.delta > 0 ? "+" : ""}{comparison.delta.toFixed(1)}cm · {comparison.description}</span></div>
                  <div className="relative mt-3 h-1.5 bg-surface"><span aria-hidden="true" className="absolute left-1/2 top-[-3px] h-3 w-px bg-zinc-500" /><span aria-hidden="true" className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-ink" style={{ left: `${comparison.progressPercent}%` }} /></div>
                  <div className="mt-2 flex justify-between font-mono text-[9px] font-bold text-muted"><span>내 옷 {comparison.personalValue.toFixed(1)}cm</span><span>상품 {comparison.productValue.toFixed(1)}cm</span></div>
                </div>
              ))}
            </div>
          )}

          {garment.profile && !editing && <div className="mt-5 flex justify-between border-t border-line pt-4"><Button onClick={garment.remove} type="button" variant="danger">이 기기에서 삭제</Button><Button onClick={() => setEditing(true)} type="button" variant="ghost">내 옷 실측 수정</Button></div>}
          <p className="mt-5 text-[10px] leading-5 text-muted">측정 위치, 원단 신축성, 세탁 상태에 따라 1~2cm 차이가 날 수 있습니다. 비교값은 구매 판단을 돕는 참고 정보입니다.</p>
        </div>
    </PremiumDialog>
  );
}
