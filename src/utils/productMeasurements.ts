export type GarmentMeasurementKey =
  | "chestWidthCm"
  | "totalLengthCm"
  | "shoulderWidthCm"
  | "sleeveLengthCm";

export interface GarmentMeasurements {
  chestWidthCm?: number;
  totalLengthCm?: number;
  shoulderWidthCm?: number;
  sleeveLengthCm?: number;
}

export interface SavedGarmentProfile {
  chestWidthCm: number;
  totalLengthCm: number;
  shoulderWidthCm: number;
  sleeveLengthCm?: number;
  updatedAt: string;
}

export interface GarmentMeasurementComparison {
  key: GarmentMeasurementKey;
  label: string;
  productValue: number;
  personalValue: number;
  delta: number;
  description: string;
  progressPercent: number;
}

const MEASUREMENT_RULES: ReadonlyArray<{
  key: GarmentMeasurementKey;
  label: string;
  aliases: readonly string[];
  min: number;
  max: number;
}> = [
  {
    key: "chestWidthCm",
    label: "가슴 단면",
    aliases: ["가슴단면", "가슴 단면", "가슴"],
    min: 20,
    max: 100,
  },
  {
    key: "totalLengthCm",
    label: "총장",
    aliases: ["총장", "기장"],
    min: 25,
    max: 160,
  },
  {
    key: "shoulderWidthCm",
    label: "어깨",
    aliases: ["어깨너비", "어깨 너비", "어깨"],
    min: 20,
    max: 100,
  },
  {
    key: "sleeveLengthCm",
    label: "소매",
    aliases: ["소매길이", "소매 길이", "소매"],
    min: 10,
    max: 120,
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function isMeasurementInRange(
  key: GarmentMeasurementKey,
  value: number,
): boolean {
  const rule = MEASUREMENT_RULES.find((candidate) => candidate.key === key);
  return Boolean(rule && Number.isFinite(value) && value >= rule.min && value <= rule.max);
}

/**
 * 라벨과 cm 단위가 모두 명시된 값만 수집합니다. 일반 사이즈 95/100/M을
 * 신체 또는 옷 실측으로 추정하지 않습니다.
 */
export function parseProductMeasurements(
  ...sources: Array<string | null | undefined>
): GarmentMeasurements {
  const text = sources.filter(Boolean).join(" / ").normalize("NFKC");
  const result: GarmentMeasurements = {};

  for (const rule of MEASUREMENT_RULES) {
    const aliases = [...rule.aliases]
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|");
    const expression = new RegExp(
      `(?:^|[\\s/|,;·(])(?:${aliases})\\s*[:：]?\\s*(\\d{1,3}(?:\\.\\d)?)\\s*(?:cm|㎝)(?=$|[\\s/|,;·)])`,
      "iu",
    );
    const match = text.match(expression);
    if (!match) continue;

    const value = Number(match[1]);
    if (isMeasurementInRange(rule.key, value)) {
      result[rule.key] = rounded(value);
    }
  }

  return result;
}

export function countProductMeasurements(value: GarmentMeasurements): number {
  return MEASUREMENT_RULES.reduce(
    (count, rule) => count + (value[rule.key] === undefined ? 0 : 1),
    0,
  );
}

function describeDelta(key: GarmentMeasurementKey, delta: number): string {
  const absolute = Math.abs(delta);
  if (absolute <= 0.5) return "거의 동일";

  if (key === "chestWidthCm" || key === "shoulderWidthCm") {
    return delta > 0 ? `${absolute.toFixed(1)}cm 여유` : `${absolute.toFixed(1)}cm 슬림`;
  }
  return delta > 0 ? `${absolute.toFixed(1)}cm 길음` : `${absolute.toFixed(1)}cm 짧음`;
}

export function compareGarmentMeasurements(
  product: GarmentMeasurements,
  personal: SavedGarmentProfile,
): GarmentMeasurementComparison[] {
  return MEASUREMENT_RULES.flatMap((rule) => {
    const productValue = product[rule.key];
    const personalValue = personal[rule.key];
    if (productValue === undefined || personalValue === undefined) return [];

    const delta = rounded(productValue - personalValue);
    return [
      {
        key: rule.key,
        label: rule.label,
        productValue,
        personalValue,
        delta,
        description: describeDelta(rule.key, delta),
        progressPercent: Math.max(8, Math.min(92, 50 + delta * 5)),
      },
    ];
  });
}

export const GARMENT_MEASUREMENT_LABELS = Object.freeze(
  Object.fromEntries(MEASUREMENT_RULES.map((rule) => [rule.key, rule.label])) as Record<
    GarmentMeasurementKey,
    string
  >,
);
