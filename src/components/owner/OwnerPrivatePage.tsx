"use client";

import { notFound } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { StaffChatInbox } from "@/src/components/chat/StaffChatInbox";
import { Button, ThemeToggle } from "@/src/components/common";
import { OwnerAuctionControlPanel } from "@/src/components/owner/OwnerAuctionControlPanel";
import { OwnerDelegationPanel } from "@/src/components/owner/OwnerDelegationPanel";
import { OwnerEmergencyControlPanel } from "@/src/components/owner/OwnerEmergencyControlPanel";
import { OwnerHiddenTestPanel } from "@/src/components/owner/OwnerHiddenTestPanel";
import { OwnerRbacPanel } from "@/src/components/owner/OwnerRbacPanel";
import { OwnerSecurityAdminPanel } from "@/src/components/owner/OwnerSecurityAdminPanel";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { isOwnerRole } from "@/src/lib/supabase/auth";

const workspaces = [
  {
    id: "security",
    index: "01",
    label: "보안 & 감사 관제",
    eyebrow: "SECURITY & AUDIT",
    description: "원문 활동 로그, 회원 로그 요청, 세션 IP와 CIDR 차단 규칙을 통합 관제합니다.",
    icon: "shield",
  },
  {
    id: "sandbox",
    index: "02",
    label: "시뮬레이터 & 샌드박스",
    eyebrow: "SANDBOX & SIMULATOR",
    description: "운영자 컨텍스트, 숨김 테스터와 경매 안전 제어로 실제 서비스 흐름을 검증합니다.",
    icon: "lab",
  },
  {
    id: "rbac",
    index: "03",
    label: "5단계 계층 권한",
    eyebrow: "RBAC HIERARCHY",
    description: "회원 권한을 검색·정렬하고 승급·강등 및 변경 이력을 감사 가능한 형태로 관리합니다.",
    icon: "users",
  },
  {
    id: "emergency",
    index: "04",
    label: "시스템 긴급 제어",
    eyebrow: "EMERGENCY OVERRIDE",
    description: "결제 런타임과 고위험 시스템 상태를 검증하고 지원되는 서버 제어만 실행합니다.",
    icon: "bolt",
  },
] as const;

type WorkspaceId = (typeof workspaces)[number]["id"];
type SandboxTool = "delegation" | "tester" | "auction";

const sandboxTools: Array<{
  id: SandboxTool;
  index: string;
  label: string;
  description: string;
}> = [
  { id: "delegation", index: "A", label: "운영자 컨텍스트", description: "승인된 운영자 업무 상태 대행" },
  { id: "tester", index: "B", label: "숨김 서비스 테스터", description: "회원 전체 여정 격리 검증" },
  { id: "auction", index: "C", label: "경매 안전 제어", description: "가격 조정·즉시 마감 감사 실행" },
];

export function OwnerPrivatePage() {
  const auth = useAuthSession();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("security");
  const [visitedWorkspaces, setVisitedWorkspaces] = useState<Set<WorkspaceId>>(
    () => new Set(["security"]),
  );
  const [sandboxTool, setSandboxTool] = useState<SandboxTool>("delegation");
  const [visitedSandboxTools, setVisitedSandboxTools] = useState<Set<SandboxTool>>(
    () => new Set(["delegation"]),
  );
  const workspaceRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!auth.isLoading && auth.user && auth.session && isOwnerRole(auth.role)) {
      document.title = "Control Plane | NINETY-NINE VINTAGE";
    }
  }, [auth.isLoading, auth.role, auth.session, auth.user]);

  if (auth.isLoading) return <OwnerGateState />;

  if (!auth.user || !auth.session || !isOwnerRole(auth.role)) {
    notFound();
  }

  const ownerUserId = auth.user.id;

  const selectWorkspace = (id: WorkspaceId) => {
    setActiveWorkspace(id);
    setVisitedWorkspaces((current) => new Set(current).add(id));
  };

  const selectSandboxTool = (id: SandboxTool) => {
    setSandboxTool(id);
    setVisitedSandboxTools((current) => new Set(current).add(id));
  };

  const handleWorkspaceKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % workspaces.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + workspaces.length) % workspaces.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = workspaces.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const next = workspaces[nextIndex];
    selectWorkspace(next.id);
    workspaceRefs.current[nextIndex]?.focus();
  };

  const activeMeta = workspaces.find((workspace) => workspace.id === activeWorkspace) ?? workspaces[0];
  const accessToken = auth.session.access_token;

  return (
    <main className="theme-app-shell min-h-screen px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:py-5 lg:px-6">
      <div className="mx-auto w-full max-w-[1720px]">
        <header className="theme-surface-glass rounded-xl border border-zinc-800/80 px-4 py-4 backdrop-blur sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] font-black tracking-[0.2em] text-[var(--accent-text)]">
                  NINETY-NINE MASTER CONTROL PLANE
                </p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] font-black tabular-nums text-[var(--success-text)]">
                  <span className="size-1.5 rounded-full bg-current shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" aria-hidden="true" />
                  LEVEL 0 VERIFIED
                </span>
              </div>
              <h1 className="mt-1.5 text-2xl font-black tracking-[-0.035em] text-[var(--text-strong)] sm:text-3xl">
                통합 관제 콘솔
              </h1>
              <p className="mt-1.5 max-w-3xl break-keep text-xs font-semibold leading-5 text-[var(--text-muted)] sm:text-sm sm:leading-6">
                공개 서비스에서는 운영자로만 식별됩니다. 이 콘솔의 조회·승인·차단·대행·테스트 조작은 실행자와 사유가 감사 원장에 보존됩니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Button size="sm" variant="secondary" onClick={() => window.location.assign("/")}>
                일반 운영 화면
              </Button>
            </div>
          </div>
        </header>

        <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start">
          <aside className="sticky top-[calc(env(safe-area-inset-top)+.5rem)] z-30 min-w-0 lg:top-3 lg:z-10">
            <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[var(--surface)] shadow-sm">
              <div className="hidden border-b border-zinc-800/80 px-4 py-4 lg:block">
                <p className="font-mono text-[9px] font-black tracking-[0.2em] text-[var(--text-muted)]">CONTROL WORKSPACE</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg border border-zinc-800 bg-zinc-950/50 font-mono text-xs font-black text-[var(--text-strong)]">NN</span>
                  <div>
                    <p className="text-xs font-black text-[var(--text-strong)]">Private operations</p>
                    <p className="mt-0.5 font-mono text-[9px] font-bold tabular-nums text-[var(--text-muted)]">NO-STORE · AUDITED</p>
                  </div>
                </div>
              </div>

              <nav
                role="tablist"
                aria-label="총책임자 관제 워크스페이스"
                className="flex min-w-0 touch-pan-x snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain scroll-smooth p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:block lg:space-y-1 lg:overflow-visible lg:snap-none"
              >
                {workspaces.map((workspace, index) => {
                  const isActive = activeWorkspace === workspace.id;
                  return (
                    <button
                      key={workspace.id}
                      ref={(node) => { workspaceRefs.current[index] = node; }}
                      type="button"
                      role="tab"
                      id={`owner-tab-${workspace.id}`}
                      aria-selected={isActive}
                      aria-controls={`owner-panel-${workspace.id}`}
                      tabIndex={isActive ? 0 : -1}
                      onKeyDown={(event) => handleWorkspaceKeyDown(event, index)}
                      onClick={() => selectWorkspace(workspace.id)}
                      className={`group relative flex min-h-12 min-w-[10.75rem] shrink-0 snap-start items-center gap-3 rounded-lg border-l-2 px-3 py-3 text-left transition-all duration-200 ease-out lg:min-w-0 lg:w-full ${
                        isActive
                          ? "border-l-white bg-zinc-800/60 text-[var(--text-strong)] shadow-sm"
                          : "border-l-transparent text-[var(--text-muted)] hover:bg-zinc-800/30 hover:text-[var(--text-strong)]"
                      }`}
                    >
                      <OwnerWorkspaceIcon name={workspace.icon} active={isActive} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[9px] font-black tabular-nums opacity-60">{workspace.index}</span>
                          <span className="truncate text-xs font-black">{workspace.label}</span>
                        </span>
                        <span className="mt-1 hidden truncate text-[10px] font-semibold opacity-60 lg:block">{workspace.eyebrow}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="hidden border-t border-zinc-800/80 p-3 lg:block">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-3">
                  <p className="flex items-center gap-2 text-[10px] font-black text-[var(--text-strong)]">
                    <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                    접근 경계 정상
                  </p>
                  <p className="mt-1.5 break-keep text-[10px] font-semibold leading-4 text-[var(--text-muted)]">
                    민감 API는 매 요청마다 Kakao 계정, 고정 UUID, owner 역할과 0등급을 재검증합니다.
                  </p>
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-xl border border-zinc-800/80 bg-[var(--surface)] shadow-sm">
            <header className="border-b border-zinc-800/80 bg-[var(--surface-muted)]/55 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] font-black tracking-[0.18em] text-[var(--accent-text)]">{activeMeta.eyebrow}</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-[var(--text-strong)]">{activeMeta.label}</h2>
                  <p className="mt-1 max-w-3xl break-keep text-xs font-semibold leading-5 text-[var(--text-muted)]">{activeMeta.description}</p>
                </div>
                <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950/30 px-3 py-1.5 font-mono text-[10px] font-black tabular-nums text-[var(--text-muted)]">
                  MODULE {activeMeta.index} / 04
                </span>
              </div>
            </header>

            <div className="min-w-0 p-3 sm:p-4 lg:p-5">
              {workspaces.map((workspace) =>
                visitedWorkspaces.has(workspace.id) ? (
                  <div
                    key={workspace.id}
                    id={`owner-panel-${workspace.id}`}
                    role="tabpanel"
                    aria-labelledby={`owner-tab-${workspace.id}`}
                    hidden={activeWorkspace !== workspace.id}
                    className="min-w-0"
                  >
                    {workspace.id === "security" ? (
                      <OwnerSecurityAdminPanel
                        accessToken={accessToken}
                        supportReview={
                          <div className="min-w-0">
                            <StaffChatInbox staffId={ownerUserId} role="admin" />
                          </div>
                        }
                      />
                    ) : null}

                    {workspace.id === "sandbox" ? (
                      <SandboxWorkspace
                        activeTool={sandboxTool}
                        visitedTools={visitedSandboxTools}
                        accessToken={accessToken}
                        onSelectTool={selectSandboxTool}
                      />
                    ) : null}

                    {workspace.id === "rbac" ? <OwnerRbacPanel accessToken={accessToken} /> : null}

                    {workspace.id === "emergency" ? (
                      <OwnerEmergencyControlPanel
                        accessToken={accessToken}
                        onOpenSandbox={() => {
                          selectSandboxTool("auction");
                          selectWorkspace("sandbox");
                        }}
                      />
                    ) : null}
                  </div>
                ) : null,
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SandboxWorkspace({
  activeTool,
  visitedTools,
  accessToken,
  onSelectTool,
}: {
  activeTool: SandboxTool;
  visitedTools: Set<SandboxTool>;
  accessToken: string;
  onSelectTool: (tool: SandboxTool) => void;
}) {
  return (
    <section className="min-w-0" aria-label="시뮬레이터 도구">
      <div className="flex touch-pan-x snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth rounded-xl border border-zinc-800/80 bg-zinc-950/20 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-3 sm:overflow-visible sm:snap-none" role="tablist" aria-label="샌드박스 도구">
        {sandboxTools.map((tool) => {
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`sandbox-panel-${tool.id}`}
              onClick={() => onSelectTool(tool.id)}
              className={`min-h-12 min-w-[11rem] shrink-0 snap-start rounded-lg border px-3 py-3 text-left transition-all duration-200 ease-out sm:min-w-0 ${isActive ? "border-zinc-600 bg-zinc-800/70 shadow-sm" : "border-transparent hover:border-zinc-800 hover:bg-zinc-900/40"}`}
            >
              <span className="font-mono text-[9px] font-black tabular-nums text-[var(--text-muted)]">LAB {tool.index}</span>
              <span className="mt-1 block text-xs font-black text-[var(--text-strong)]">{tool.label}</span>
              <span className="mt-1 block text-[10px] font-semibold leading-4 text-[var(--text-muted)]">{tool.description}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 min-w-0">
        {visitedTools.has("delegation") ? (
          <div id="sandbox-panel-delegation" role="tabpanel" hidden={activeTool !== "delegation"}>
            <OwnerDelegationPanel accessToken={accessToken} />
          </div>
        ) : null}
        {visitedTools.has("tester") ? (
          <div id="sandbox-panel-tester" role="tabpanel" hidden={activeTool !== "tester"}>
            <OwnerHiddenTestPanel accessToken={accessToken} />
          </div>
        ) : null}
        {visitedTools.has("auction") ? (
          <div id="sandbox-panel-auction" role="tabpanel" hidden={activeTool !== "auction"}>
            <OwnerAuctionControlPanel />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function OwnerWorkspaceIcon({ name, active }: { name: string; active: boolean }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  let path: ReactNode;
  if (name === "shield") {
    path = <><path d="M12 3 5.5 5.8v5.3c0 4.4 2.7 7.7 6.5 9.9 3.8-2.2 6.5-5.5 6.5-9.9V5.8L12 3Z" /><path d="m9.5 12 1.7 1.7 3.7-4" /></>;
  } else if (name === "lab") {
    path = <><path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 3.7h9.6A2.5 2.5 0 0 0 19 17l-5-9V3" /><path d="M7.5 15h9" /></>;
  } else if (name === "users") {
    path = <><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3.5" /><path d="M17 11a3 3 0 1 0 0-6M22 20v-1.5a4 4 0 0 0-3-3.7" /></>;
  } else {
    path = <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />;
  }
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors ${active ? "border-zinc-600 bg-zinc-950/60 text-white" : "border-zinc-800 bg-zinc-950/20 text-zinc-500 group-hover:text-zinc-300"}`}>
      <svg {...common} className="size-4">{path}</svg>
    </span>
  );
}

function OwnerGateState() {
  return (
    <main className="theme-app-shell grid min-h-screen place-items-center px-4 py-12">
      <section className="w-full max-w-sm rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-5" role="status" aria-label="페이지 확인 중">
        <div className="flex items-center gap-3">
          <span className="commerce-skeleton size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="commerce-skeleton block h-3 w-32 rounded" />
            <span className="commerce-skeleton block h-2.5 w-full rounded" />
          </div>
        </div>
      </section>
    </main>
  );
}
