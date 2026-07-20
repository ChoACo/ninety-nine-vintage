import type { ReactNode } from "react";

type SectionHeadingVariant = "page" | "section";

export function SectionHeading({
  action,
  className = "",
  description,
  eyebrow,
  title,
  titleClassName = "",
  variant = "section",
}: Readonly<{
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  variant?: SectionHeadingVariant;
}>) {
  const isPage = variant === "page";
  const Heading = isPage ? "h1" : "h2";

  return (
    <div
      className={`${isPage ? "flex items-end justify-between border-b border-ink pb-6" : "mb-5 flex items-end justify-between border-b border-ink pb-4"} ${className}`.trim()}
    >
      <div>
        <p className="eyebrow text-muted">{eyebrow}</p>
        <Heading
          className={(titleClassName || (isPage
            ? "mt-3 text-4xl font-black tracking-[-.08em]"
            : "mt-2 text-xl font-black tracking-[-0.05em]")).trim()}
        >
          {title}
        </Heading>
        {description && (
          <p className="mt-3 text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
