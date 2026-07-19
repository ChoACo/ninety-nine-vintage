import { BadgeCheck, Ruler } from "lucide-react";
import type { ItemDetail } from "@/types/detail";

interface ConditionReportProps {
  item: ItemDetail;
}

export function ConditionReport({ item }: ConditionReportProps) {
  const rows = [
    ["어깨", `${item.measurements.shoulder} cm`],
    ["가슴", `${item.measurements.chest} cm`],
    ["소매", `${item.measurements.sleeve} cm`],
    ["총장", `${item.measurements.length} cm`],
  ];

  return (
    <section className="col-span-7 mt-14 border-t border-zinc-950 pt-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-[0.15em] text-zinc-500">AUTHENTICITY / CONDITION</p>
          <h2 className="text-lg font-black tracking-[-0.04em]">VINTAGE INSPECTION REPORT</h2>
        </div>
        <span className="flex items-center gap-1.5 border border-zinc-200 px-3 py-2 text-[11px] font-bold text-zinc-700">
          <BadgeCheck size={14} /> 전문가 검수 완료
        </span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-8">
        <div className="border-y border-zinc-200">
          <div className="flex items-center gap-2 border-b border-zinc-200 py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈</div>
          {rows.map(([label, value]) => (
            <div className="flex justify-between border-b border-zinc-100 py-3 text-xs last:border-b-0" key={label}>
              <span className="text-zinc-500">{label}</span>
              <span className="font-mono font-medium text-zinc-950">{value}</span>
            </div>
          ))}
        </div>
        <div className="border border-zinc-200 bg-zinc-50 p-5">
          <h3 className="mb-3 text-xs font-bold">사용감 및 하자 안내</h3>
          <ul className="space-y-3 text-xs leading-5 text-zinc-600">
            {item.inspectionNotes.map((note) => <li className="border-l-2 border-zinc-300 pl-3" key={note}>{note}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
