export type ConditionGrade = "" | "S" | "A" | "B" | "C";

export const PRODUCT_CONDITIONS = ["S", "A", "B", "C"] as const;

export const CONDITION_LABELS: Record<
  Exclude<ConditionGrade, "">,
  string
> = {
  S: "새상품",
  A: "사용감 적음",
  B: "사용감 있음",
  C: "사용감 많음·하자 있음",
};

export const CONDITION_OPTIONS = PRODUCT_CONDITIONS.map((value) => ({
  value,
  label: CONDITION_LABELS[value],
}));

export type NormalizedConditionGrade = Exclude<ConditionGrade, "">;

export function isConditionGrade(
  value: string,
): value is NormalizedConditionGrade {
  return (PRODUCT_CONDITIONS as readonly string[]).includes(value);
}

export function normalizeConditionGrade(
  value: unknown,
): NormalizedConditionGrade | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "A+") return "A";
  return isConditionGrade(normalized) ? normalized : null;
}

export function formatConditionGrade(value: unknown): string | null {
  const grade = normalizeConditionGrade(value);
  return grade ? `Grade ${grade} · ${CONDITION_LABELS[grade]}` : null;
}
