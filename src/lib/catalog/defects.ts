export interface DefectTag {
  code: string;
  label: string;
}

export const DEFECT_TAGS: readonly DefectTag[] = [
  { code: "minor_stain", label: "미세 오염" },
  { code: "stain", label: "얼룩" },
  { code: "color_transfer", label: "이염" },
  { code: "fading", label: "탈색" },
  { code: "neck_stretch", label: "목 늘어남" },
  { code: "snag", label: "올 풀림" },
  { code: "wear", label: "마모" },
  { code: "pilling", label: "보풀" },
  { code: "wrinkle", label: "주름·접힘 자국" },
  { code: "distortion", label: "변형" },
  { code: "zipper", label: "지퍼 손상" },
  { code: "button", label: "단추 손상" },
  { code: "elastic", label: "고무줄 늘어남" },
  { code: "trim_lost", label: "장식 탈락" },
  { code: "repair", label: "수선 흔적" },
  { code: "repurposed", label: "패치·리폼" },
];

const DEFECT_CODE_SET = new Set(DEFECT_TAGS.map((tag) => tag.code));

export const DEFECT_LABELS: Record<string, string> = Object.fromEntries(
  DEFECT_TAGS.map((tag) => [tag.code, tag.label]),
);

export function isDefectTagCode(value: string): value is DefectTag["code"] {
  return DEFECT_CODE_SET.has(value);
}

export function normalizeDefectTags(
  value: unknown,
  maximum = 20,
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const code = candidate.trim();
    if (code && isDefectTagCode(code) && !seen.has(code)) {
      seen.add(code);
      normalized.push(code);
    }
    if (normalized.length >= maximum) break;
  }
  return normalized;
}