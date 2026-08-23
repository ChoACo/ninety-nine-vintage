import {
  CategoryTabBar,
  type CategoryTabItem,
} from "@/components/common/CategoryTabBar";

const CATEGORIES = [
  ["전체", ""],
  ["아우터", "아우터"],
  ["상의", "상의"],
  ["하의", "하의"],
  ["원피스/스커트", "원피스"],
  ["가방/신발", "가방"],
  ["액세서리", "액세서리"],
] as const;

export function CategoryChips({
  activeCategory = "",
  basePath = "/shop",
}: {
  activeCategory?: string;
  basePath?: string;
}) {
  const items: readonly CategoryTabItem[] = CATEGORIES.map(([label, value]) => ({
    href: value
      ? `${basePath}?category=${encodeURIComponent(value)}`
      : basePath,
    label,
    value,
  }));

  return (
    <CategoryTabBar
      ariaLabel="아카이브 상품 카테고리"
      items={items}
      value={activeCategory}
    />
  );
}
