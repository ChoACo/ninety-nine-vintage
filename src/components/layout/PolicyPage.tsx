import { PcLayout } from "@/components/layout/PcLayout";

export function PolicyPage({ eyebrow, title, paragraphs }: { eyebrow: string; title: string; paragraphs: string[] }) {
  return <PcLayout><div className="mx-auto max-w-3xl space-y-10"><div className="border-b border-ink pb-7"><p className="eyebrow text-muted">{eyebrow}</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">{title}</h1></div><div className="space-y-6 text-sm leading-8 text-muted">{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></div></PcLayout>;
}
