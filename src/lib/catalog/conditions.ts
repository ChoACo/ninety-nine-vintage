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

export function isConditionGrade(
  value: string,
): value is Exclude<ConditionGrade, ""> {
  return (PRODUCT_CONDITIONS as readonly string[]).includes(value);
}