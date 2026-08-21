"use client";

import { ChevronDown, CreditCard, Heart, PackageCheck, RotateCcw, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { AccountDashboard, type AccountDashboardView } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { RoleWorkCenterLink } from "@/components/features/account/RoleWorkCenterLink";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";
import { SiteSettingsPage } from "@/components/settings/SiteSettingsPage";

type TaskView = "home" | AccountDashboardView | "orders" | "bids" | "nickname" | "notifications" | "site-settings";
type Task = { label: string; view: TaskView };
type Category = { description: string; icon: typeof CreditCard; label: string; tasks: Task[] };

const categories: Category[] = [
  { label: "주문·결제", description: "결제 대기와 주문 내역", icon: CreditCard, tasks: [{ label: "결제하기", view: "payments" }, { label: "주문 내역", view: "orders" }] },
  { label: "보관 / 배송", description: "보관 상품 선택과 배송 신청", icon: PackageCheck, tasks: [{ label: "보관 상품", view: "storage" }, { label: "배송 현황", view: "shipping" }, { label: "배송지 관리", view: "addresses" }] },
  { label: "취소·환불", description: "환불 계좌와 처리 상태", icon: RotateCcw, tasks: [{ label: "환불 상태·계좌", view: "refunds" }] },
  { label: "내 활동", description: "입찰과 찜 목록", icon: Heart, tasks: [{ label: "입찰 현황", view: "bids" }, { label: "찜한 상품", view: "saved" }] },
  { label: "설정", description: "계정과 사이트 환경 설정", icon: Settings, tasks: [
    { label: "닉네임", view: "nickname" },
    { label: "알림", view: "notifications" },
    { label: "배송지", view: "addresses" },
    { label: "사이트 설정", view: "site-settings" },
  ] },
];

const homeTask: Task = { label: "홈", view: "home" };

function TaskContent({ onNavigate, simpleModeEnabled, task }: { onNavigate: (view: AccountDashboardView) => void; simpleModeEnabled: boolean; task: Task }) {
  if (task.view === "home") return <><AccountDashboard homeOnly onNavigate={onNavigate} surface="desktop" view={simpleModeEnabled ? "simple" : "overview"} /><RoleWorkCenterLink /></>;
  if (task.view === "orders") return <OrderHistory surface="desktop" />;
  if (task.view === "bids") return <BidHistory surface="desktop" />;
  if (task.view === "nickname") return <NicknameSettings />;
  if (task.view === "notifications") return <MobilePwaControls detailed />;
  if (task.view === "site-settings") return <SiteSettingsPage surface="desktop" />;
  return <AccountDashboard surface="desktop" view={task.view} />;
}

export function DesktopAccountContent() {
  const simpleMode = useSimpleMode();
  const [requestedTask, setRequestedTask] = useState<string | null>(null);
  const allTasks = useMemo(() => categories.flatMap((category) => category.tasks), []);
  const activeTask = requestedTask ? allTasks.find((task) => task.view === requestedTask) ?? homeTask : homeTask;
  const activeCategory = categories.find((category) => category.tasks.some((task) => task.view === requestedTask)) ?? null;

  useEffect(() => {
    const syncTaskFromUrl = () => setRequestedTask(new URLSearchParams(window.location.search).get("task"));
    syncTaskFromUrl();
    window.addEventListener("popstate", syncTaskFromUrl);
    return () => window.removeEventListener("popstate", syncTaskFromUrl);
  }, []);

  const openTask = (task: Task) => {
    window.history.pushState({}, "", `/account?task=${encodeURIComponent(task.view)}`);
    setRequestedTask(task.view);
  };
  const openCategory = (category: Category) => openTask(category.tasks[0]);
  const openHome = () => {
    window.history.pushState({}, "", "/account");
    setRequestedTask(null);
  };
  const openView = (view: AccountDashboardView) => {
    const task = allTasks.find((candidate) => candidate.view === view);
    if (task) openTask(task);
  };
  return (
    <main className="mx-auto w-full max-w-[1540px] px-5 sm:px-8">
      <section className="overflow-hidden border border-line bg-paper text-ink shadow-sm" aria-label="MY 작업 공간">
        <header className="border-b border-line px-5 py-5 sm:px-7"><p className="eyebrow text-muted">MY</p><h1 className="mt-2 text-3xl font-black tracking-[-0.08em]">내 작업 공간</h1><p className="mt-2 text-xs text-muted">홈에서 처리할 일을 확인하고 필요한 작업을 선택하세요.</p></header>
        <div className="grid min-h-[680px] md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-line bg-surface p-3 md:border-b-0 md:border-r">
            <nav aria-label="MY 작업 메뉴">
              <p className="px-3 pb-2 text-[10px] font-black tracking-[0.14em] text-muted">작업 메뉴</p>
              <button aria-current={activeTask.view === "home" ? "page" : undefined} className={`mb-2 flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold ${activeTask.view === "home" ? "bg-paper text-ink" : "text-muted hover:bg-paper hover:text-ink"}`} onClick={openHome} type="button">홈</button>
              {categories.map((category) => {
                const categoryActive = category.label === activeCategory?.label;
                const taskGroupId = `my-task-group-${category.label}`;
                return <div key={category.label}>
                  <button aria-controls={taskGroupId} aria-current={categoryActive ? "page" : undefined} aria-expanded={categoryActive} className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold ${categoryActive ? "bg-paper text-ink" : "text-muted hover:bg-paper hover:text-ink"}`} onClick={() => openCategory(category)} type="button">{category.label}<ChevronDown aria-hidden="true" className={`transition-transform ${categoryActive ? "rotate-180" : ""}`} size={14} /></button>
                  {categoryActive && <div className="mb-2 mt-1 space-y-1 border-l border-line pl-2" id={taskGroupId}>{category.tasks.map((task) => <button aria-current={task.view === activeTask.view ? "page" : undefined} className={`block w-full px-3 py-2 text-left text-xs ${task.view === activeTask.view ? "bg-ink font-bold text-paper" : "text-muted hover:bg-paper hover:text-ink"}`} key={task.label} onClick={() => openTask(task)} type="button">{task.label}</button>)}</div>}
                </div>;
              })}
            </nav>
          </aside>
          <div className="min-h-0 overflow-y-auto p-5 sm:p-7"><TaskContent onNavigate={openView} simpleModeEnabled={simpleMode.enabled} task={activeTask} /></div>
        </div>
      </section>
    </main>
  );
}
