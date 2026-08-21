"use client";

import { ChevronRight, CreditCard, Heart, PackageCheck, RotateCcw, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { AccountDashboard, type AccountDashboardView } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { RoleWorkCenterLink } from "@/components/features/account/RoleWorkCenterLink";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";
import { SiteSettingsPage } from "@/components/settings/SiteSettingsPage";

type TaskView = AccountDashboardView | "orders" | "bids" | "nickname" | "notifications" | "site-settings";
type Task = { label: string; view: TaskView };
type Category = { description: string; icon: typeof CreditCard; label: string; tasks: Task[] };

const categories: Category[] = [
  { label: "주문·결제", description: "결제 대기와 주문 내역", icon: CreditCard, tasks: [{ label: "결제하기", view: "payments" }, { label: "주문 내역", view: "orders" }] },
  { label: "보관·배송", description: "보관 상품부터 배송 신청까지", icon: PackageCheck, tasks: [{ label: "보관 상품", view: "storage" }, { label: "배송 신청", view: "shipping-request" }, { label: "배송 현황", view: "shipping" }, { label: "배송지 관리", view: "addresses" }] },
  { label: "취소·환불", description: "환불 계좌와 처리 상태", icon: RotateCcw, tasks: [{ label: "환불 상태·계좌", view: "refunds" }] },
  { label: "내 활동", description: "입찰과 찜 목록", icon: Heart, tasks: [{ label: "입찰 현황", view: "bids" }, { label: "찜한 상품", view: "saved" }] },
  { label: "설정", description: "계정과 사이트 환경 설정", icon: Settings, tasks: [
    { label: "닉네임", view: "nickname" },
    { label: "알림", view: "notifications" },
    { label: "배송지", view: "addresses" },
    { label: "사이트 설정", view: "site-settings" },
  ] },
];

function TaskContent({ task }: { task: Task }) {
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
  const activeTask = allTasks.find((task) => task.view === requestedTask) ?? null;
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
  const closeTask = () => {
    window.history.pushState({}, "", "/account");
    setRequestedTask(null);
  };
  const openView = (view: AccountDashboardView) => {
    const task = allTasks.find((candidate) => candidate.view === view);
    if (task) openTask(task);
  };
  return (
    <>
      <main className="mx-auto w-full max-w-[1540px] space-y-10 px-5 sm:px-8">
        <AccountDashboard onNavigate={openView} surface="desktop" view={simpleMode.enabled ? "simple" : "overview"} />
        <section className="border-b border-ink pb-8"><p className="eyebrow text-muted">MY / 작업 메뉴</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">필요한 작업을 바로 열어보세요</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">요약 카드 아래에서 작업을 선택하면 같은 페이지에 세부 내용이 이어집니다. 주소에도 현재 작업이 기록됩니다.</p></section>
        <section aria-label="MY 업무 분류" className="grid gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-5">{categories.map((category) => { const Icon = category.icon; return <button className="group flex min-h-40 flex-col justify-between bg-paper p-6 text-left transition-colors hover:bg-surface" key={category.label} onClick={() => openCategory(category)} type="button"><span className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-full bg-surface"><Icon size={19} /></span><ChevronRight className="text-muted transition-transform group-hover:translate-x-1" size={18} /></span><span><strong className="block text-lg font-black">{category.label}</strong><span className="mt-1 block text-xs text-muted">{category.description}</span></span></button>; })}</section>
        <RoleWorkCenterLink />
      </main>
      {activeCategory && activeTask && <section aria-labelledby="my-task-content-title" className="border border-line bg-paper"><header className="flex flex-col gap-4 border-b border-line bg-surface px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div><p className="eyebrow text-muted">MY / {activeCategory.label}</p><h2 className="mt-1 text-xl font-black" id="my-task-content-title">{activeTask.label}</h2></div><button aria-label="MY 작업 닫기" className="w-fit border border-line bg-paper px-4 py-2 text-xs font-bold" onClick={closeTask} type="button">작업 닫기</button></header><nav aria-label="선택한 작업의 세부 메뉴" className="flex flex-wrap gap-2 border-b border-line px-5 py-3 sm:px-7">{activeCategory.tasks.map((task) => <button aria-current={task.view === activeTask.view ? "page" : undefined} className={`border px-3 py-2 text-xs font-bold ${task.view === activeTask.view ? "border-ink bg-ink text-paper" : "border-line text-muted hover:bg-surface hover:text-ink"}`} key={task.label} onClick={() => openTask(task)} type="button">{task.label}</button>)}</nav><div className="p-5 sm:p-7"><TaskContent task={activeTask} /></div></section>}
    </>
  );
}
