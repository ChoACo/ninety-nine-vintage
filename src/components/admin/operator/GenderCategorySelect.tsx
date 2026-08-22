export const CATEGORY_MAP = {
  MALE: ["남성 아우터", "남성 상의", "남성 하의", "남성 셋업"],
  FEMALE: ["여성 아우터", "여성 상의", "여성 하의", "원피스/스커트"],
  UNISEX: ["공용 아우터", "공용 상의", "공용 하의"],
  ACCESSORY: ["가방", "모자", "신발", "벨트/지갑", "기타 잡화"],
} as const;

export type RegistrationGender = "남성" | "여성" | "남녀공용" | "잡화/액세서리";

const GROUPS: Array<{
  key: keyof typeof CATEGORY_MAP;
  label: RegistrationGender;
}> = [
  { key: "MALE", label: "남성" },
  { key: "FEMALE", label: "여성" },
  { key: "UNISEX", label: "남녀공용" },
  { key: "ACCESSORY", label: "잡화/액세서리" },
];

export function GenderCategorySelect({
  category,
  gender,
  onChange,
}: Readonly<{
  category: string;
  gender: RegistrationGender;
  onChange: (gender: RegistrationGender, category: string) => void;
}>) {
  const group =
    GROUPS.find((candidate) => candidate.label === gender) ?? GROUPS[0];
  const categories = CATEGORY_MAP[group.key];
  return (
    <fieldset className="space-y-3 sm:col-span-2">
      <legend className="text-xs font-black">성별·상품군</legend>
      <div className="flex flex-wrap gap-2">
        {GROUPS.map((candidate) => {
          const active = candidate.label === gender;
          return (
            <button
              aria-pressed={active}
              className={`min-h-11 rounded-full border px-4 text-xs font-bold transition-colors ${active ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:border-ink"}`}
              key={candidate.key}
              onClick={() =>
                onChange(candidate.label, CATEGORY_MAP[candidate.key][0])
              }
              type="button"
            >
              {candidate.label}
            </button>
          );
        })}
      </div>
      <label className="block text-[10px] font-bold text-muted">
        카테고리
        <select
          aria-label="카테고리"
          className="mt-2 min-h-11 w-full border border-line bg-paper px-3 text-xs text-ink outline-none focus:border-ink"
          onChange={(event) => onChange(gender, event.target.value)}
          value={
            categories.some((item) => item === category)
              ? category
              : categories[0]
          }
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
