"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/src/components/common";
import { OwnerDangerConfirmModal } from "@/src/components/owner/OwnerDangerConfirmModal";
import { listOwnerSecurityActivity, type OwnerSecurityActivity } from "@/src/lib/securityAudit/client";
import {
  getStaffMemberDirectory,
  setMemberAccessRole,
  type ManagedAccessRole,
  type StaffMemberDirectoryEntry,
} from "@/src/lib/supabase/operations";

interface OwnerRbacPanelProps {
  accessToken: string;
}

type RoleFilter = "all" | ManagedAccessRole;
type SortKey = "recent" | "name" | "role" | "last_seen";

const PAGE_SIZE = 24;

const roleMeta: Record<
  ManagedAccessRole,
  { grade: string; label: string; description: string; className: string }
> = {
  operator: {
    grade: "1",
    label: "운영자",
    description: "사이트 운영과 회원·상품 업무",
    className: "border-violet-400/25 bg-violet-400/10 text-[var(--text-strong)]",
  },
  employee: {
    grade: "2",
    label: "직원",
    description: "상품 등록과 배송 대기 업무",
    className: "border-sky-400/25 bg-sky-400/10 text-[var(--text-strong)]",
  },
  band_member: {
    grade: "2.5",
    label: "기존 밴드 회원",
    description: "결제 기한 특례가 있는 회원",
    className: "border-amber-400/25 bg-amber-400/10 text-[var(--warning-text)]",
  },
  member: {
    grade: "3",
    label: "일반 회원",
    description: "구매·입찰 기본 권한",
    className: "border-zinc-700 bg-zinc-900/70 text-[var(--text-muted)]",
  },
};

const hierarchy = [
  {
    grade: "0",
    label: "총책임자",
    description: "고정된 단일 계정 · 변경 대상에서 제외",
    className: "border-red-400/25 bg-red-400/10 text-[var(--danger-text)]",
  },
  ...Object.values(roleMeta),
];

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string | null): string {
  if (!value) return "기록 없음";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "기록 없음" : dateTimeFormatter.format(parsed);
}

function historyRole(value: unknown): string {
  if (typeof value !== "string") return "-";
  if (value === "owner") return "총책임자";
  return roleMeta[value as ManagedAccessRole]?.label ?? value;
}

export function OwnerRbacPanel({ accessToken }: OwnerRbacPanelProps) {
  const [members, setMembers] = useState<StaffMemberDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingChange, setPendingChange] = useState<{
    member: StaffMemberDirectoryEntry;
    role: ManagedAccessRole;
  } | null>(null);
  const [historyMember, setHistoryMember] = useState<StaffMemberDirectoryEntry | null>(null);
  const [historyReason, setHistoryReason] = useState("");
  const [historyItems, setHistoryItems] = useState<OwnerSecurityActivity[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const loadMembers = async () => {
    setIsLoading(true);
    setError("");
    try {
      setMembers(await getStaffMemberDirectory());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "회원 권한 목록을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void getStaffMemberDirectory()
      .then((items) => {
        if (active) setMembers(items);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "회원 권한 목록을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const next: Record<ManagedAccessRole, number> = {
      operator: 0,
      employee: 0,
      band_member: 0,
      member: 0,
    };
    for (const member of members) next[member.accessRole] += 1;
    return next;
  }, [members]);

  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const filtered = members.filter((member) => {
      if (roleFilter !== "all" && member.accessRole !== roleFilter) return false;
      if (!normalizedQuery) return true;
      return [member.displayName, member.legalName, member.email, member.phone, member.id].some(
        (value) => value?.toLocaleLowerCase("ko-KR").includes(normalizedQuery),
      );
    });

    return filtered.sort((left, right) => {
      if (sortKey === "name") {
        return (left.displayName ?? "").localeCompare(right.displayName ?? "", "ko-KR");
      }
      if (sortKey === "role") {
        return Number(roleMeta[left.accessRole].grade) - Number(roleMeta[right.accessRole].grade);
      }
      if (sortKey === "last_seen") {
        return (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [members, query, roleFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedMembers = filteredMembers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const confirmRoleChange = async () => {
    if (!pendingChange || mutatingId) return;
    const { member, role } = pendingChange;
    setMutatingId(member.id);
    setError("");
    setMessage("");
    try {
      const updatedRole = await setMemberAccessRole(member.id, role);
      setMembers((current) =>
        current.map((entry) =>
          entry.id === member.id ? { ...entry, accessRole: updatedRole } : entry,
        ),
      );
      setMessage(
        `${member.displayName || "회원"}의 권한을 ${roleMeta[updatedRole].label}(으)로 변경했습니다. 변경 이력은 감사 로그에 보존됩니다.`,
      );
      setPendingChange(null);
      if (historyMember?.id === member.id) setHistoryItems([]);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "회원 권한을 변경하지 못했습니다.",
      );
    } finally {
      setMutatingId("");
    }
  };

  const openHistory = (member: StaffMemberDirectoryEntry) => {
    setHistoryMember(member);
    setHistoryReason("");
    setHistoryItems([]);
  };

  const loadHistory = async () => {
    if (!historyMember || historyReason.trim().length < 10 || isHistoryLoading) return;
    setIsHistoryLoading(true);
    setError("");
    const to = new Date();
    const from = new Date(to);
    from.setFullYear(from.getFullYear() - 1);
    try {
      setHistoryItems(
        await listOwnerSecurityActivity(accessToken, {
          userId: historyMember.id,
          category: "authorization",
          from: from.toISOString(),
          to: to.toISOString(),
          limit: 200,
          reason: historyReason.trim(),
        }),
      );
    } catch (historyError) {
      setError(
        historyError instanceof Error
          ? historyError.message
          : "권한 변경 이력을 불러오지 못했습니다.",
      );
    } finally {
      setIsHistoryLoading(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="owner-rbac-title">
      <div className="rounded-xl border border-zinc-800/80 bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[var(--accent-text)]">
              RBAC HIERARCHY ENGINE
            </p>
            <h2 id="owner-rbac-title" className="mt-1 text-xl font-black tracking-tight text-[var(--text-strong)] sm:text-2xl">
              5단계 계층 권한 제어
            </h2>
            <p className="mt-2 max-w-3xl break-keep text-sm font-semibold leading-6 text-[var(--text-muted)]">
              총책임자 등급은 고정되어 변경 목록에 노출되지 않습니다. 나머지 권한 변경은 서버 검증을 거치며 변경 전후 값이 보안 감사 로그에 남습니다.
            </p>
          </div>
          <Button size="sm" variant="ghost" isLoading={isLoading} onClick={() => void loadMembers()}>
            데이터 새로고침
          </Button>
        </div>

        <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="권한 등급 체계">
          {hierarchy.map((role) => (
            <li key={role.grade} className={`rounded-lg border p-3 ${role.className}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-black tabular-nums">LEVEL {role.grade}</span>
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              </div>
              <p className="mt-2 text-sm font-black">{role.label}</p>
              <p className="mt-1 text-[11px] font-semibold leading-4 opacity-75">{role.description}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[var(--surface)]">
        <div className="grid gap-3 border-b border-zinc-800/80 bg-[var(--surface-muted)]/70 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_11rem] sm:p-4">
          <label className="min-w-0 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Member search
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="닉네임, 실명, 연락처 또는 UUID"
              className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-colors focus:border-zinc-600"
            />
          </label>
          <label className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Role filter
            <select
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value as RoleFilter);
                setPage(1);
              }}
              className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 text-sm font-semibold text-[var(--text-strong)] outline-none focus:border-zinc-600"
            >
              <option value="all">전체 권한</option>
              {(Object.keys(roleMeta) as ManagedAccessRole[]).map((role) => (
                <option key={role} value={role}>
                  {roleMeta[role].grade}등급 · {roleMeta[role].label} ({counts[role]})
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Sort
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 text-sm font-semibold text-[var(--text-strong)] outline-none focus:border-zinc-600"
            >
              <option value="recent">가입 최신순</option>
              <option value="name">닉네임순</option>
              <option value="role">권한 등급순</option>
              <option value="last_seen">최근 접속순</option>
            </select>
          </label>
        </div>

        {message ? (
          <p role="status" className="border-b border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-[var(--success-text)]">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="border-b border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        {isLoading && members.length === 0 ? (
          <div className="space-y-2 p-4" role="status" aria-label="회원 권한 목록을 불러오는 중">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="commerce-skeleton h-14 rounded-lg" />
            ))}
          </div>
        ) : pagedMembers.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid size-10 place-items-center rounded-full border border-zinc-800 font-mono text-zinc-500" aria-hidden="true">0</span>
              <p className="mt-3 text-sm font-black text-[var(--text-strong)]">조건에 맞는 계정이 없습니다</p>
              <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">검색어나 권한 필터를 변경해 주세요.</p>
            </div>
          </div>
        ) : (
          <div className="touch-pan-x overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[920px] table-fixed border-collapse text-left">
              <thead className="border-b border-zinc-800/80 bg-zinc-950/30 font-mono text-[9px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <tr>
                  <th className="w-[28%] px-4 py-2.5">Account</th>
                  <th className="w-[18%] px-4 py-2.5">Current role</th>
                  <th className="w-[19%] px-4 py-2.5">Last seen</th>
                  <th className="w-[18%] px-4 py-2.5">State</th>
                  <th className="w-[17%] px-4 py-2.5 text-right">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {pagedMembers.map((member) => {
                  const role = roleMeta[member.accessRole];
                  const isMutating = mutatingId === member.id;
                  return (
                    <tr key={member.id} className="transition-colors duration-200 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 align-middle">
                        <p className="truncate text-sm font-black text-[var(--text-strong)]">{member.displayName || "닉네임 미설정"}</p>
                        <p className="mt-1 truncate font-mono text-[10px] font-semibold tabular-nums tracking-tight text-[var(--text-muted)]" title={member.id}>{member.id}</p>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${role.className}`}>
                          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                          {role.grade} · {role.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
                        {formatDateTime(member.lastSeenAt)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`rounded-full border px-2 py-1 text-[9px] font-black ${member.accountStatus === "active" ? "border-emerald-400/25 bg-emerald-400/10 text-[var(--success-text)]" : "border-red-400/25 bg-red-400/10 text-[var(--danger-text)]"}`}>
                            {member.accountStatus === "active" ? "활성" : "이용 정지"}
                          </span>
                          {member.paymentDeadlineExempt ? <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[9px] font-black text-[var(--warning-text)]">결제 특례</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openHistory(member)}>이력</Button>
                          <select
                            aria-label={`${member.displayName || "회원"} 권한 변경`}
                            value={member.accessRole}
                            disabled={isMutating}
                            onChange={(event) => {
                              const roleValue = event.target.value as ManagedAccessRole;
                              if (roleValue !== member.accessRole) setPendingChange({ member, role: roleValue });
                            }}
                            className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 text-xs font-bold text-[var(--text-strong)] outline-none transition-colors hover:border-zinc-700 focus:border-zinc-600 sm:min-h-9"
                          >
                            {(Object.keys(roleMeta) as ManagedAccessRole[]).map((roleValue) => (
                              <option key={roleValue} value={roleValue}>{roleMeta[roleValue].label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 px-4 py-3">
          <p className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
            {filteredMembers.length.toLocaleString("ko-KR")} ACCOUNTS · PAGE {safePage}/{totalPages}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</Button>
            <Button size="sm" variant="ghost" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>다음</Button>
          </div>
        </div>
      </div>

      {historyMember ? (
        <section className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[var(--surface)]" aria-labelledby="role-history-title">
          <div className="flex flex-col gap-3 border-b border-zinc-800/80 p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-black tracking-[0.15em] text-[var(--accent-text)]">IMMUTABLE ROLE HISTORY</p>
              <h3 id="role-history-title" className="mt-1 truncate text-base font-black text-[var(--text-strong)]">{historyMember.displayName || "회원"} · 권한 변경 이력</h3>
              <p className="mt-1 truncate font-mono text-[10px] font-semibold text-[var(--text-muted)]">{historyMember.id}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setHistoryMember(null)}>닫기</Button>
          </div>
          <div className="grid gap-3 border-b border-zinc-800/80 bg-[var(--surface-muted)]/60 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="min-w-0 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Audited review reason
              <input
                value={historyReason}
                onChange={(event) => setHistoryReason(event.target.value)}
                minLength={10}
                maxLength={500}
                placeholder="권한 오남용 점검 등 구체적인 열람 사유 (10자 이상)"
                className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 text-sm font-semibold text-[var(--text-strong)] outline-none focus:border-zinc-600"
              />
            </label>
            <Button size="sm" isLoading={isHistoryLoading} disabled={historyReason.trim().length < 10} onClick={() => void loadHistory()}>감사 기록 후 조회</Button>
          </div>
          {historyItems.length === 0 ? (
            <p className="p-5 text-center text-xs font-semibold text-[var(--text-muted)]">조회 전이거나 최근 1년간 권한 변경 이력이 없습니다.</p>
          ) : (
            <div className="touch-pan-x overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-zinc-800/80 font-mono text-[9px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  <tr><th className="px-4 py-2.5">Time</th><th className="px-4 py-2.5">Actor</th><th className="px-4 py-2.5">Change</th><th className="px-4 py-2.5">Event</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {historyItems.map((item) => (
                    <tr key={item.logKey} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">{formatDateTime(item.occurredAt)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-[var(--text-strong)]">{item.actorDisplayName || "시스템"}</td>
                      <td className="px-4 py-3 text-xs font-black text-[var(--text-strong)]">{historyRole(item.metadata.previous_role)} <span className="text-[var(--text-muted)]">→</span> {historyRole(item.metadata.role)}</td>
                      <td className="px-4 py-3 font-mono text-[10px] font-bold text-[var(--text-muted)]">{item.eventType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <OwnerDangerConfirmModal
        open={Boolean(pendingChange)}
        tone={pendingChange?.role === "operator" ? "danger" : "warning"}
        eyebrow="RBAC CHANGE REQUEST"
        title="회원 권한을 변경할까요?"
        description="권한 변경은 즉시 적용되며 기존 세션의 접근 범위에도 영향을 줄 수 있습니다. 서버가 변경 가능 범위를 다시 검증합니다."
        confirmLabel="권한 변경 확정"
        isLoading={Boolean(mutatingId)}
        details={pendingChange ? [
          { label: "대상", value: pendingChange.member.displayName || pendingChange.member.id },
          { label: "현재 권한", value: `${roleMeta[pendingChange.member.accessRole].grade}등급 · ${roleMeta[pendingChange.member.accessRole].label}` },
          { label: "변경 권한", value: `${roleMeta[pendingChange.role].grade}등급 · ${roleMeta[pendingChange.role].label}` },
        ] : []}
        onCancel={() => setPendingChange(null)}
        onConfirm={confirmRoleChange}
      />
    </section>
  );
}
