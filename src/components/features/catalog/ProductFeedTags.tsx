import { getProductFeedTags } from "@/lib/catalog/productFeedTags";

interface ProductFeedTagsProps {
  description?: string | null;
  gender?: string | null;
  size?: string | null;
}

export function ProductFeedTags({
  description,
  gender,
  size,
}: ProductFeedTagsProps) {
  const tags = getProductFeedTags({ description, gender, size });
  if (tags.length === 0) return null;

  return (
    <div aria-label="상품 요약 태그" className="mt-2 flex min-w-0 flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          className="max-w-full truncate rounded-full border border-line bg-surface px-2 py-1 text-[9px] font-bold leading-none text-muted"
          data-tag-kind={tag.kind}
          key={`${tag.kind}:${tag.label}`}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}
