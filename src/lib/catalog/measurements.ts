export type MeasurementKey =
  | "shoulder"
  | "chest"
  | "sleeve"
  | "waist"
  | "rise"
  | "thigh"
  | "hem"
  | "hip"
  | "length"
  | "width"
  | "height"
  | "depth"
  | "circumference"
  | "brimLength"
  | "footLength"
  | "footWidth"
  | "heelHeight"
  | "totalLength";

export const MEASUREMENT_LABELS: Readonly<Record<MeasurementKey, string>> = {
  shoulder: "어깨",
  chest: "가슴",
  sleeve: "소매",
  waist: "허리",
  rise: "밑위",
  thigh: "허벅지",
  hem: "밑단",
  hip: "힙",
  length: "총장",
  width: "가로",
  height: "세로",
  depth: "폭",
  circumference: "둘레",
  brimLength: "챙 길이",
  footLength: "발길이",
  footWidth: "발볼",
  heelHeight: "굽 높이",
  totalLength: "전체 길이",
};

const MEASUREMENT_KEY_ORDER: readonly MeasurementKey[] = [
  "shoulder",
  "chest",
  "sleeve",
  "waist",
  "rise",
  "thigh",
  "hem",
  "hip",
  "length",
  "width",
  "height",
  "depth",
  "circumference",
  "brimLength",
  "footLength",
  "footWidth",
  "heelHeight",
  "totalLength",
];

export interface MeasurementPreset {
  fields: readonly MeasurementKey[];
  label: string;
}

export const MEASUREMENT_PRESETS: Readonly<
  Record<
    | "top"
    | "outer"
    | "bottom"
    | "onepiece"
    | "jumpsuit"
    | "setup"
    | "bag"
    | "hat"
    | "shoes"
    | "beltWallet"
    | "goods",
    MeasurementPreset
  >
> = {
  top: {
    fields: ["shoulder", "chest", "sleeve", "length"],
    label: "상의 실측",
  },
  outer: {
    fields: ["shoulder", "chest", "sleeve", "length"],
    label: "아우터 실측",
  },
  bottom: {
    fields: ["waist", "rise", "thigh", "hem", "length"],
    label: "하의 실측",
  },
  onepiece: {
    fields: ["chest", "waist", "hip", "length"],
    label: "원피스 실측",
  },
  jumpsuit: {
    fields: ["chest", "waist", "thigh", "hem", "length"],
    label: "점프수트 실측",
  },
  setup: {
    fields: ["shoulder", "chest", "sleeve", "length", "waist", "hem"],
    label: "셋업 실측",
  },
  bag: { fields: ["width", "height", "depth"], label: "가방 규격" },
  hat: { fields: ["circumference", "brimLength"], label: "모자 규격" },
  shoes: {
    fields: ["footLength", "footWidth", "heelHeight"],
    label: "신발 규격",
  },
  beltWallet: {
    fields: ["width", "height", "totalLength"],
    label: "벨트·지갑 규격",
  },
  goods: { fields: ["width", "height", "depth"], label: "잡화 규격" },
};

const GROUP_PRESETS: Readonly<Record<string, MeasurementPreset | null>> = {
  상의: MEASUREMENT_PRESETS.top,
  아우터: MEASUREMENT_PRESETS.outer,
  하의: MEASUREMENT_PRESETS.bottom,
  바지: MEASUREMENT_PRESETS.bottom,
  치마: MEASUREMENT_PRESETS.bottom,
  원피스: MEASUREMENT_PRESETS.onepiece,
  스커트: MEASUREMENT_PRESETS.bottom,
  점프수트: MEASUREMENT_PRESETS.jumpsuit,
  셋업: MEASUREMENT_PRESETS.setup,
  "셋업/세트": MEASUREMENT_PRESETS.setup,
  액세서리: MEASUREMENT_PRESETS.goods,
  잡화: MEASUREMENT_PRESETS.goods,
  가방: MEASUREMENT_PRESETS.bag,
  모자: MEASUREMENT_PRESETS.hat,
  신발: MEASUREMENT_PRESETS.shoes,
  "벨트/지갑": MEASUREMENT_PRESETS.beltWallet,
  "기타 잡화": MEASUREMENT_PRESETS.goods,
};

export function measurementPresetForCategory(
  category: string | null | undefined,
): MeasurementPreset | null {
  const normalized = typeof category === "string" ? category.trim() : "";
  if (!normalized || normalized === "기타") return null;
  // Batch labels follow "<성별> · <그룹> · <아이템>"; the middle segment picks
  // the preset. Free-text categories fall back to a substring match.
  const group = normalized
    .split("·")
    .map((segment) => segment.trim())[1];
  if (group && Object.hasOwn(GROUP_PRESETS, group)) {
    return GROUP_PRESETS[group];
  }
  for (const [candidate, preset] of Object.entries(GROUP_PRESETS)) {
    if (preset && normalized.includes(candidate)) return preset;
  }
  return null;
}

const MAX_MEASUREMENT_CM = 500;

function normalizeMeasurementValue(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_MEASUREMENT_CM) {
    return null;
  }
  return Math.round(parsed * 10) / 10;
}

export function normalizeMeasurements(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const key of MEASUREMENT_KEY_ORDER) {
    if (!Object.hasOwn(record, key)) continue;
    const measurement = normalizeMeasurementValue(record[key]);
    if (measurement !== null) normalized[key] = measurement;
  }
  return normalized;
}

export function collectMeasurements(
  values: Record<string, string>,
): Record<string, number> {
  const collected: Record<string, number> = {};
  for (const key of MEASUREMENT_KEY_ORDER) {
    const raw = values[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const measurement = normalizeMeasurementValue(raw);
    if (measurement !== null) collected[key] = measurement;
  }
  return collected;
}

export function measurementEntries(
  value: unknown,
): Array<{ key: MeasurementKey; label: string; value: number }> {
  const normalized = normalizeMeasurements(value);
  return MEASUREMENT_KEY_ORDER.flatMap((key) => {
    const measurement = normalized[key];
    return measurement !== undefined
      ? [{ key, label: MEASUREMENT_LABELS[key], value: measurement }]
      : [];
  });
}
