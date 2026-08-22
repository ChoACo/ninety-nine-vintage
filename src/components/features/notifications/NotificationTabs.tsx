import type { NotificationCategory, NotificationTabDefinition } from "@/lib/notifications/types";

export function NotificationTabs({ active, onChange, tabs }: { active: NotificationCategory; onChange: (category: NotificationCategory) => void; tabs: readonly NotificationTabDefinition[] }) {
  return <div aria-label="알림 카테고리" className="flex overflow-x-auto border-b border-line [scrollbar-width:none]" role="tablist">
    {tabs.map((tab) => <button aria-controls="notification-list" aria-selected={active === tab.id} className={`min-h-11 shrink-0 px-3 text-[10px] font-bold ${active === tab.id ? "border-b-2 border-ink text-ink" : "text-muted"}`} id={`notification-tab-${tab.id.toLowerCase()}`} key={tab.id} onClick={() => onChange(tab.id)} role="tab" type="button">{tab.label}</button>)}
  </div>;
}
