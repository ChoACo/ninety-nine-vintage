export type BatchClothingGender = "여성" | "남성";

export interface BatchClothingCategory {
  gender: BatchClothingGender;
  group: string;
  id: string;
  item: string;
  label: string;
}

const CATEGORY_ROWS: ReadonlyArray<
  readonly [BatchClothingGender, string, string, string]
> = [
  ["여성", "아우터", "패딩", "310300200"],
  ["여성", "아우터", "점퍼", "310300100"],
  ["여성", "아우터", "코트", "310300300"],
  ["여성", "아우터", "자켓", "310300400"],
  ["여성", "아우터", "가디건", "310300600"],
  ["여성", "아우터", "조끼/베스트", "310300500"],
  ["여성", "상의", "니트", "310260800"],
  ["여성", "상의", "후드티/후드집업", "310260700"],
  ["여성", "상의", "맨투맨", "310260600"],
  ["여성", "상의", "블라우스", "310260500"],
  ["여성", "상의", "셔츠", "310260400"],
  ["여성", "상의", "반팔 티셔츠", "310260100"],
  ["여성", "상의", "긴팔 티셔츠", "310260200"],
  ["여성", "상의", "민소매 티셔츠", "310260300"],
  ["여성", "바지", "데님/청바지", "310150080"],
  ["여성", "바지", "슬랙스", "310150010"],
  ["여성", "바지", "면바지", "310150030"],
  ["여성", "바지", "반바지", "310150090"],
  ["여성", "바지", "트레이닝/조거팬츠", "310150040"],
  ["여성", "바지", "레깅스", "310150070"],
  ["여성", "바지", "기타 바지", "310150999"],
  ["여성", "치마", "롱스커트", "310130030"],
  ["여성", "치마", "미디스커트", "310130080"],
  ["여성", "치마", "미니스커트", "310130040"],
  ["여성", "원피스", "롱원피스", "310120030"],
  ["여성", "원피스", "미디원피스", "310120110"],
  ["여성", "원피스", "미니원피스", "310120020"],
  ["여성", "점프수트", "점프수트", "310250"],
  ["여성", "셋업/세트", "정장 셋업", "310400100"],
  ["여성", "셋업/세트", "트레이닝/스웨터 셋업", "310400200"],
  ["여성", "셋업/세트", "기타 셋업/세트", "310400999"],
  ["남성", "아우터", "패딩", "320300300"],
  ["남성", "아우터", "점퍼", "320300200"],
  ["남성", "아우터", "코트", "320300100"],
  ["남성", "아우터", "자켓", "320300400"],
  ["남성", "아우터", "가디건", "320300600"],
  ["남성", "아우터", "조끼/베스트", "320300500"],
  ["남성", "상의", "후드티/후드집업", "320210600"],
  ["남성", "상의", "맨투맨", "320210500"],
  ["남성", "상의", "니트/스웨터", "320210700"],
  ["남성", "상의", "셔츠", "320210400"],
  ["남성", "상의", "반팔 티셔츠", "320210100"],
  ["남성", "상의", "긴팔 티셔츠", "320210200"],
  ["남성", "상의", "민소매 티셔츠", "320210300"],
  ["남성", "바지", "데님/청바지", "320120600"],
  ["남성", "바지", "면바지", "320120100"],
  ["남성", "바지", "슬랙스", "320120200"],
  ["남성", "바지", "트레이닝/조거팬츠", "320120300"],
  ["남성", "바지", "반바지", "320120700"],
  ["남성", "바지", "기타 바지", "320120999"],
  ["남성", "점프수트", "점프수트", "320400"],
  ["남성", "셋업/세트", "정장 셋업", "320500100"],
  ["남성", "셋업/세트", "트레이닝/스웨터 셋업", "320500200"],
  ["남성", "셋업/세트", "기타 셋업/세트", "320500999"],
];

export const BATCH_CLOTHING_CATEGORIES: readonly BatchClothingCategory[] =
  CATEGORY_ROWS.map(([gender, group, item, id]) => ({
    gender,
    group,
    id,
    item,
    label: `${gender} · ${group} · ${item}`,
  }));

const CATEGORY_BY_ID = new Map(
  BATCH_CLOTHING_CATEGORIES.map((category) => [category.id, category]),
);

export function normalizeBatchCategoryId(value: unknown): string {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
  }
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim();
  return /^\d{6,9}$/u.test(normalized) ? normalized : "";
}

export function getBatchClothingCategory(
  value: unknown,
): BatchClothingCategory | null {
  const id = normalizeBatchCategoryId(value);
  return id ? CATEGORY_BY_ID.get(id) ?? null : null;
}

export function findBatchClothingCategory(
  values: readonly unknown[],
): BatchClothingCategory | null {
  for (const value of values) {
    const category = getBatchClothingCategory(value);
    if (category) return category;
  }
  return null;
}
