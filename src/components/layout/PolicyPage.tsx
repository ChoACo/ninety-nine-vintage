import { SectionHeading } from "@/components/ui/SectionHeading";

export function PolicyPage({ eyebrow, title, paragraphs }: { eyebrow: string; title: string; paragraphs: string[] }) {
  return <div className="mx-auto max-w-3xl space-y-10"><SectionHeading className="pb-7" eyebrow={eyebrow} title={title} variant="page" /><div className="space-y-6 text-sm leading-8 text-muted">{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></div>;
}
