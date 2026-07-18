"use client";

import { useState, type FormEvent } from "react";

import { Button, Modal } from "@/src/components/common";
import { useGarmentSizeProfile } from "@/src/hooks/useGarmentSizeProfile";
import {
  compareGarmentMeasurements,
  countProductMeasurements,
  GARMENT_MEASUREMENT_LABELS,
  parseProductMeasurements,
  type GarmentMeasurementKey,
  type SavedGarmentProfile,
} from "@/src/utils/productMeasurements";

const PROFILE_FIELDS: ReadonlyArray<{
  key: GarmentMeasurementKey;
  required: boolean;
  placeholder: string;
}> = [
  { key: "chestWidthCm", required: true, placeholder: "예: 54" },
  { key: "totalLengthCm", required: true, placeholder: "예: 70" },
  { key: "shoulderWidthCm", required: true, placeholder: "예: 47" },
  { key: "sleeveLengthCm", required: false, placeholder: "선택" },
];

interface SizeComparisonPanelProps {
  productDescription: string;
  productSize?: string;
  userId?: string | null;
  compact?: boolean;
}

function ProfileEditor({
  profile,
  persistsOnDevice,
  onSave,
  onCancel,
}: {
  profile: SavedGarmentProfile | null;
  persistsOnDevice: boolean;
  onSave: (profile: Omit<SavedGarmentProfile, "updatedAt">) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<Record<GarmentMeasurementKey, string>>({
    chestWidthCm: profile ? String(profile.chestWidthCm) : "",
    totalLengthCm: profile ? String(profile.totalLengthCm) : "",
    shoulderWidthCm: profile ? String(profile.shoulderWidthCm) : "",
    sleeveLengthCm:
      profile?.sleeveLengthCm === undefined ? "" : String(profile.sleeveLengthCm),
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
        sleeveLengthCm: values.sleeveLengthCm
          ? Number(values.sleeveLengthCm)
          : undefined,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "옷 실측값을 저장하지 못했습니다.",
      );
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        {PROFILE_FIELDS.map((field) => (
          <label key={field.key} className="text-[11px] font-bold text-[var(--text-muted)]">
            {GARMENT_MEASUREMENT_LABELS[field.key]}
            {field.required ? <span className="text-[var(--danger-text)]"> *</span> : null}
            <span className="relative mt-1.5 block">
              <input
                type="number"
                inputMode="decimal"
                min="10"
                max="160"
                step="0.1"
                required={field.required}
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                placeholder={field.placeholder}
                className="min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-3 pr-9 font-mono text-sm font-bold tabular-nums text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-[var(--text-muted)]">cm</span>
            </span>
          </label>
        ))}
      </div>
      <p className="break-keep text-[11px] font-medium leading-5 text-[var(--text-muted)]">
        {persistsOnDevice
          ? "이 기기에만 회원별로 저장되며 서버나 운영자에게 전송되지 않습니다."
          : "로그인 전에는 현재 브라우저 탭에서만 임시로 유지되며 서버로 전송되지 않습니다."}
      </p>
      {error ? (
        <p role="alert" className="rounded-lg border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-3 py-2 text-xs font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        ) : null}
        <Button type="submit" size="sm">
          내 옷 실측 저장
        </Button>
      </div>
    </form>
  );
}

export function SizeComparisonPanel({
  productDescription,
  productSize,
  userId,
  compact = false,
}: SizeComparisonPanelProps) {
  const garment = useGarmentSizeProfile(userId);
  const [editing, setEditing] = useState(false);
  const productMeasurements = parseProductMeasurements(
    productSize,
    productDescription,
  );
  const productMeasurementCount = countProductMeasurements(productMeasurements);
  const comparisons = garment.profile
    ? compareGarmentMeasurements(productMeasurements, garment.profile)
    : [];

  if (!garment.hydrated) {
    return <div className="commerce-skeleton h-36 rounded-xl" aria-label="저장된 옷 실측 불러오는 중" />;
  }

  return (
    <section className={compact ? "space-y-3" : "space-y-4"}>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent-text)]">
              GARMENT TO GARMENT
            </p>
            <h3 className="mt-1 text-sm font-black tracking-tight text-[var(--text-strong)]">
              잘 맞는 내 옷과 실측 비교
            </h3>
          </div>
          <span className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-[10px] font-black tabular-nums text-[var(--text-muted)]">
            상품 실측 {productMeasurementCount}개
          </span>
        </div>
      </div>

      {!garment.profile || editing ? (
        <ProfileEditor
          key={garment.profile?.updatedAt ?? "new-profile"}
          profile={garment.profile}
          persistsOnDevice={garment.persistsOnDevice}
          onSave={(profile) => {
            garment.save(profile);
            setEditing(false);
          }}
          onCancel={garment.profile ? () => setEditing(false) : undefined}
        />
      ) : productMeasurementCount < 2 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-6 text-center">
          <span aria-hidden="true" className="text-2xl">📐</span>
          <p className="mt-2 text-sm font-bold text-[var(--text-strong)]">상품 실측 정보 준비 중</p>
          <p className="mt-1 break-keep text-xs font-medium leading-5 text-[var(--text-muted)]">
            `가슴단면 56cm · 총장 72cm`처럼 명시된 실측이 2개 이상 등록되면 자동 비교합니다.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {comparisons.map((comparison) => (
            <div key={comparison.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-[var(--text-strong)]">{comparison.label}</span>
                <span className="font-mono text-xs font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                  {comparison.delta > 0 ? "+" : ""}{comparison.delta.toFixed(1)}cm · {comparison.description}
                </span>
              </div>
              <div className="relative mt-3 h-1.5 rounded-full bg-[var(--surface-muted)]">
                <span className="absolute left-1/2 top-[-3px] h-3 w-px bg-[var(--border-strong)]" aria-hidden="true" />
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] shadow-sm transition-[left] duration-300"
                  style={{ left: `${comparison.progressPercent}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[9px] font-bold tabular-nums text-[var(--text-muted)]">
                <span>내 옷 {comparison.personalValue.toFixed(1)}cm</span>
                <span>상품 {comparison.productValue.toFixed(1)}cm</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {garment.profile && !editing ? (
        <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] pt-3">
          <button type="button" onClick={garment.remove} className="min-h-10 text-xs font-bold text-[var(--danger-text)] underline-offset-4 hover:underline">
            이 기기에서 삭제
          </button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            내 옷 실측 수정
          </Button>
        </div>
      ) : null}

      <p className="break-keep text-[10px] font-medium leading-5 text-[var(--text-muted)]">
        측정 위치, 원단 신축성, 세탁 상태에 따라 1~2cm 차이가 날 수 있습니다. 비교값은 구매 판단을 돕는 참고 정보입니다.
      </p>
    </section>
  );
}

export interface SizeComparisonScannerProps extends SizeComparisonPanelProps {
  open: boolean;
  productTitle: string;
  onClose: () => void;
}

export default function SizeComparisonScanner({
  open,
  productTitle,
  productDescription,
  productSize,
  userId,
  onClose,
}: SizeComparisonScannerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="내 옷과 실측 비교하기"
      description={`‘${productTitle}’의 명시된 옷 실측과 비교합니다.`}
      size="sm"
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="p-5 sm:p-6">
        <SizeComparisonPanel
          productDescription={productDescription}
          productSize={productSize}
          userId={userId}
        />
      </div>
    </Modal>
  );
}
