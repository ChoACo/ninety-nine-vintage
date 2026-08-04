import { getProductFeedTags } from "@/lib/catalog/productFeedTags";

interface ProductFeedTagsProps {
  description?: string | null;
  gender?: string | null;
  hashtags?: string[];
  size?: string | null;
}

export function ProductFeedTags({
  description,
  gender,
  hashtags,
  size,
}: ProductFeedTagsProps) {
  const tags = getProductFeedTags({ description, gender, size });
  if (tags.length === 0 && (!hashtags || hashtags.length === 0)) return null;

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
      {hashtags?.slice(0, 4).map((tag) => (
        <span
          className="max-w-full truncate rounded-full border border-emerald-200 bg-emerald-50/50 px-2 py-1 text-[9px] font-bold leading-none text-emerald-800"
          data-tag-kind="hashtag"
          key={`hashtag:${tag}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
