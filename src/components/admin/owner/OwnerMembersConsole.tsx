"use client";

import { Gavel, RefreshCw, Save, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OwnerNicknameReviewPanel } from "@/components/admin/owner/OwnerNicknameReviewPanel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface Sanction {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  source: "automatic" | "manual";
}

interface Member {
  id: string;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  account_status: string;
  suspended_until: string | null;
  suspension_reason: string | null;
  shipping_credit_count: number | null;
  address_count: number;
  bid_count: number;
  created_at: string;
  last_seen_at: string | null;
  access_role: string | null;
  reports_to_operator_id: string | null;
  warning_count: number;
  sanction_count: number;
  bid_blocked_until: string | null;
  active_sanctions: Sanction[];
  is_deleted: boolean;
}

type MemberSegment = "all" | "active" | "suspended" | "deleted";

const segmentLabels: Record<MemberSegment, string> = {
  all: "전체",
  active: "활성",
  suspended: "정지",
  deleted: "탈퇴",
};

const roleLabels: Record<string, string> = {
  owner: "소유자",
  operator: "운영자",
  employee: "직원",
  band_member: "밴드 회원",
  member: "회원",
};

function segmentForMember(member: Member): Exclude<MemberSegment, "all"> {
  if (member.is_deleted || member.account_status === "deleted") return "deleted";
  if (member.account_status === "suspended" || member.account_status === "temporary_suspended") {
    return "suspended";
  }
  return "active";
}

export function OwnerMembersConsole() {
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const [members, setMembers] = useState<Member[]>([]);
  const [segment, setSegment] = useState<MemberSegment>("active");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [until, setUntil] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [operatorDrafts, setOperatorDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/owner/members?limit=500", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await response.json() as {
        members?: Member[];
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "회원 목록을 불러오지 못했습니다.");
      }
      setMembers(payload.members ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "회원 목록을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const counts = useMemo(() => {
    const next = { all: members.length, active: 0, suspended: 0, deleted: 0 };
    for (const member of members) next[segmentForMember(member)] += 1;
    return next;
  }, [members]);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return members.filter((member) => {
      if (segment !== "all" && segmentForMember(member) !== segment) return false;
      if (!normalizedQuery) return true;
      return [
        member.id,
        member.display_name,
        member.legal_name,
        member.email,
        member.phone,
        member.access_role,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [members, query, segment]);

  const operators = useMemo(
    () => members.filter(
      (member) => member.access_role === "operator" && !member.is_deleted,
    ),
    [members],
  );

  async function mutate(body: Record<string, unknown>, success: string) {
    if (!accessToken || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/members", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "요청을 처리하지 못했습니다.");
      }
      setNotice(success);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function requireReason(member: Member, action: () => void) {
    if (!(reason[member.id] ?? "").trim()) {
      setNotice(`${member.display_name} 회원의 처리 사유를 먼저 입력해 주세요.`);
      return;
    }
    action();
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        action={(
          <button
            className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold"
            disabled={busy}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw size={13} /> 새로고침
          </button>
        )}
        description="활성·정지·탈퇴 계정을 분리해 보고 역할, 연락처, 제재와 탈퇴 데이터를 관리합니다. 소유자 본인의 연락처도 수정할 수 있습니다."
        eyebrow="소유자 / 회원·권한"
        title="회원 관리"
        variant="page"
      />

      <OwnerNicknameReviewPanel />

      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {(Object.keys(segmentLabels) as MemberSegment[]).map((value) => (
            <button
              aria-selected={segment === value}
              className={segment === value
                ? "bg-ink px-4 py-2 text-xs font-bold text-paper"
                : "border border-line px-4 py-2 text-xs font-bold"}
              key={value}
              onClick={() => setSegment(value)}
              role="tab"
              type="button"
            >
              {segmentLabels[value]} {counts[value]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            aria-label="회원 검색"
            className="min-w-0 flex-1 border border-line bg-paper px-4 py-3 text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름, 이메일, 연락처, UUID 검색"
            value={query}
          />
          <p className="shrink-0 font-mono text-sm font-bold">{visible.length}명</p>
        </div>
      </div>

      {notice && (
        <p className="border border-line bg-surface px-4 py-3 text-xs font-bold" role="status">
          {notice}
        </p>
      )}

      <div className="grid gap-4">
        {visible.map((member) => {
          const owner = member.access_role === "owner";
          const deleted = segmentForMember(member) === "deleted";
          const memberReason = reason[member.id] ?? "";
          const phone = phones[member.id] ?? member.phone ?? "";
          const roleDraft = roleDrafts[member.id] ?? member.access_role ?? "member";
          const operatorDraft =
            operatorDrafts[member.id] ?? member.reports_to_operator_id ?? "";
          const canManageCredits =
            member.access_role !== "operator" && member.access_role !== "owner";
          const canManageEnforcement =
            member.access_role === "band_member" || member.access_role === "member";

          return (
            <article className="border border-line bg-surface p-5" key={member.id}>
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserRound size={15} />
                    <p className="font-bold">{member.display_name || "이름 없음"}</p>
                    <span className="border border-line px-2 py-1 text-[10px]">
                      {deleted ? "탈퇴" : roleLabels[member.access_role ?? ""] ?? "역할 없음"}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[10px] text-muted">
                    ID {member.id}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {member.email ?? "이메일 없음"} · {member.phone ?? "연락처 없음"} ·
                    배송지 {member.address_count} · 입찰 {member.bid_count}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    상태 {member.account_status} · 경고 {member.warning_count} · 제재{" "}
                    {member.sanction_count}
                    {member.suspended_until
                      ? ` · ${new Date(member.suspended_until).toLocaleString("ko-KR")}까지`
                      : ""}
                  </p>
                </div>

                {!owner && !deleted && (
                  <div className="grid min-w-64 gap-2">
                    <select
                      aria-label={`${member.display_name} 역할`}
                      className="border border-line bg-paper px-3 py-2 text-xs"
                      disabled={busy}
                      onChange={(event) => setRoleDrafts((current) => ({
                        ...current,
                        [member.id]: event.target.value,
                      }))}
                      value={roleDraft}
                    >
                      <option value="operator">운영자</option>
                      <option value="employee">직원</option>
                      <option value="band_member">밴드 회원</option>
                      <option value="member">회원</option>
                    </select>
                    {roleDraft === "employee" && (
                      <select
                        aria-label={`${member.display_name} 담당 운영자`}
                        className="border border-line bg-paper px-3 py-2 text-xs"
                        disabled={busy}
                        onChange={(event) => setOperatorDrafts((current) => ({
                          ...current,
                          [member.id]: event.target.value,
                        }))}
                        value={operatorDraft}
                      >
                        <option value="">담당 운영자 선택</option>
                        {operators
                          .filter((operator) => operator.id !== member.id)
                          .map((operator) => (
                            <option key={operator.id} value={operator.id}>
                              {operator.display_name}
                            </option>
                          ))}
                      </select>
                    )}
                    <button
                      className="bg-ink px-3 py-2 text-xs font-bold text-paper disabled:opacity-40"
                      disabled={busy || (roleDraft === "employee" && !operatorDraft)}
                      onClick={() => void mutate({
                        action: "role",
                        memberId: member.id,
                        roleCode: roleDraft,
                        reportsToOperatorId:
                          roleDraft === "employee" ? operatorDraft : null,
                      }, "역할과 담당 운영자를 저장했습니다.")}
                      type="button"
                    >
                      역할 저장
                    </button>
                  </div>
                )}
              </div>

              {deleted ? (
                <div className="mt-5 flex flex-col justify-between gap-3 border border-rose-200 bg-rose-50 p-4 text-xs sm:flex-row sm:items-center">
                  <p>
                    인증 계정과 개인정보는 이미 제거됐습니다. 거래·감사 이력이 없는
                    탈퇴 계정은 목록에서도 완전 삭제할 수 있습니다.
                  </p>
                  <button
                    className="inline-flex shrink-0 items-center justify-center gap-1 bg-rose-700 px-4 py-3 font-bold text-white"
                    disabled={busy}
                    onClick={() => requireReason(member, () => {
                      if (window.confirm(`${member.display_name} 기록을 완전히 삭제할까요?`)) {
                        void mutate({
                          action: "purge",
                          memberId: member.id,
                          reason: memberReason,
                        }, "탈퇴 회원 정보를 완전히 삭제했습니다.");
                      }
                    })}
                    type="button"
                  >
                    <Trash2 size={12} /> 완전 삭제
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-5 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <input
                      aria-label={`${member.display_name} 연락처`}
                      className="border border-line bg-paper px-3 py-2 text-xs"
                      onChange={(event) => setPhones((current) => ({
                        ...current,
                        [member.id]: event.target.value,
                      }))}
                      value={phone}
                    />
                    <button
                      className="inline-flex items-center justify-center gap-1 border border-line px-3 py-2 text-xs font-bold"
                      disabled={busy}
                      onClick={() => void mutate({
                        action: "profile",
                        memberId: member.id,
                        phone,
                      }, "연락처를 저장했습니다.")}
                      type="button"
                    >
                      <Save size={12} /> 연락처 저장
                    </button>
                    {canManageCredits && (
                      <>
                        <button
                          className="border border-line px-3 py-2 text-xs font-bold"
                          disabled={busy}
                          onClick={() => void mutate({
                            action: "credits",
                            memberId: member.id,
                            delta: 1,
                          }, "배송권을 1장 추가했습니다.")}
                          type="button"
                        >
                          배송권 +1
                        </button>
                        <button
                          className="border border-line px-3 py-2 text-xs font-bold"
                          disabled={busy || (member.shipping_credit_count ?? 0) < 1}
                          onClick={() => void mutate({
                            action: "credits",
                            memberId: member.id,
                            delta: -1,
                          }, "배송권을 1장 차감했습니다.")}
                          type="button"
                        >
                          배송권 -1
                        </button>
                      </>
                    )}
                  </div>

                  {!owner && (
                    <>
                      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_repeat(6,auto)]">
                        <input
                          aria-label={`${member.display_name} 사유`}
                          className="border border-line bg-paper px-3 py-2 text-xs"
                          maxLength={500}
                          onChange={(event) => setReason((current) => ({
                            ...current,
                            [member.id]: event.target.value,
                          }))}
                          placeholder="정지·경고·제재·탈퇴 처리 사유"
                          value={memberReason}
                        />
                        <input
                          aria-label={`${member.display_name} 일시 정지 만료`}
                          className="border border-line bg-paper px-3 py-2 text-xs"
                          onChange={(event) => setUntil((current) => ({
                            ...current,
                            [member.id]: event.target.value,
                          }))}
                          type="datetime-local"
                          value={until[member.id] ?? ""}
                        />
                        <button
                          className="border border-line px-3 py-2 text-xs font-bold"
                          disabled={busy}
                          onClick={() => void mutate({
                            action: "status",
                            memberId: member.id,
                            status: "active",
                            reason: memberReason,
                          }, "계정을 활성화했습니다.")}
                          type="button"
                        >
                          활성
                        </button>
                        <button
                          className="border border-line px-3 py-2 text-xs font-bold"
                          disabled={busy}
                          onClick={() => requireReason(member, () => void mutate({
                            action: "status",
                            memberId: member.id,
                            status: "suspended",
                            reason: memberReason,
                          }, "계정을 무기한 정지했습니다."))}
                          type="button"
                        >
                          정지
                        </button>
                        <button
                          className="border border-line px-3 py-2 text-xs font-bold"
                          disabled={busy}
                          onClick={() => requireReason(member, () => {
                            if (!until[member.id]) {
                              setNotice("일시 정지 만료 시각을 선택해 주세요.");
                              return;
                            }
                            void mutate({
                              action: "status",
                              memberId: member.id,
                              status: "temporary_suspended",
                              suspendedUntil: new Date(until[member.id]).toISOString(),
                              reason: memberReason,
                            }, "계정을 일시 정지했습니다.");
                          })}
                          type="button"
                        >
                          일시 정지
                        </button>
                        {canManageEnforcement && (
                          <>
                            <button
                              className="border border-line px-3 py-2 text-xs font-bold"
                              disabled={busy}
                              onClick={() => requireReason(member, () => void mutate({
                                action: "warning",
                                memberId: member.id,
                                category: "manual",
                                reason: memberReason,
                              }, "경고를 추가했습니다."))}
                              type="button"
                            >
                              경고
                            </button>
                            <button
                              className="inline-flex items-center justify-center gap-1 bg-ink px-3 py-2 text-xs font-bold text-paper"
                              disabled={busy}
                              onClick={() => requireReason(member, () => void mutate({
                                action: "sanction_create",
                                memberId: member.id,
                                endsAt: new Date(Date.now() + 86_400_000).toISOString(),
                                reason: memberReason,
                              }, "24시간 제재를 추가했습니다."))}
                              type="button"
                            >
                              <Gavel size={12} /> 24시간 제재
                            </button>
                          </>
                        )}
                        <button
                          aria-label={`${member.display_name} 탈퇴 처리`}
                          className="inline-flex items-center justify-center gap-1 bg-rose-700 px-3 py-2 text-xs font-bold text-white"
                          disabled={busy}
                          onClick={() => requireReason(member, () => {
                            if (window.confirm(`${member.display_name} 계정을 익명화하고 탈퇴 처리할까요?`)) {
                              void mutate({
                                action: "delete",
                                memberId: member.id,
                                reason: memberReason,
                              }, "계정을 익명화하고 탈퇴 처리했습니다.");
                            }
                          })}
                          type="button"
                        >
                          <Trash2 size={12} /> 탈퇴 처리
                        </button>
                      </div>

                      {canManageEnforcement && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                          <span className="mr-auto text-muted">
                            누적 초기화는 관련 경고·제재 기록과 현재 입찰 제한을 함께 제거합니다.
                          </span>
                          <button
                            className="border border-line px-3 py-2 font-bold"
                            disabled={busy || member.warning_count < 1}
                            onClick={() => requireReason(member, () => {
                              if (window.confirm(`${member.display_name} 회원의 경고 누적을 초기화할까요?`)) {
                                void mutate({
                                  action: "enforcement_clear",
                                  memberId: member.id,
                                  scope: "warnings",
                                  reason: memberReason,
                                }, "경고 누적을 초기화했습니다.");
                              }
                            })}
                            type="button"
                          >
                            경고 누적 삭제
                          </button>
                          <button
                            className="border border-rose-300 px-3 py-2 font-bold text-rose-700"
                            disabled={busy || member.sanction_count < 1}
                            onClick={() => requireReason(member, () => {
                              if (window.confirm(`${member.display_name} 회원의 제재 누적을 초기화할까요?`)) {
                                void mutate({
                                  action: "enforcement_clear",
                                  memberId: member.id,
                                  scope: "sanctions",
                                  reason: memberReason,
                                }, "제재 누적을 초기화했습니다.");
                              }
                            })}
                            type="button"
                          >
                            제재 누적 삭제
                          </button>
                        </div>
                      )}

                      {member.active_sanctions.length > 0 && (
                        <div className="mt-3 grid gap-2">
                          {member.active_sanctions.map((sanction) => (
                            <div
                              className="flex flex-col justify-between gap-2 border border-line bg-paper p-3 text-xs sm:flex-row sm:items-center"
                              key={sanction.id}
                            >
                              <span>
                                <b>{new Date(sanction.endsAt).toLocaleString("ko-KR")}까지</b>
                                {" · "}
                                {sanction.reason ?? "사유 없음"} · {sanction.source}
                              </span>
                              <span className="flex gap-2">
                                <button
                                  className="border border-line px-3 py-2 font-bold"
                                  disabled={busy}
                                  onClick={() => void mutate({
                                    action: "sanction_update",
                                    memberId: member.id,
                                    sanctionId: sanction.id,
                                    endsAt: new Date(
                                      Math.max(Date.now(), new Date(sanction.endsAt).getTime()) +
                                        86_400_000,
                                    ).toISOString(),
                                    reason: memberReason || sanction.reason,
                                  }, "제재를 24시간 연장했습니다.")}
                                  type="button"
                                >
                                  24시간 연장
                                </button>
                                <button
                                  className="border border-rose-600 px-3 py-2 font-bold text-rose-700"
                                  disabled={busy}
                                  onClick={() => requireReason(member, () => void mutate({
                                    action: "sanction_cancel",
                                    memberId: member.id,
                                    sanctionId: sanction.id,
                                    reason: memberReason,
                                  }, "제재를 취소했습니다."))}
                                  type="button"
                                >
                                  제재 취소
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {deleted && (
                <input
                  aria-label={`${member.display_name} 관리 사유`}
                  className="mt-3 w-full border border-line bg-paper px-3 py-2 text-xs"
                  maxLength={500}
                  onChange={(event) => setReason((current) => ({
                    ...current,
                    [member.id]: event.target.value,
                  }))}
                  placeholder="처리 사유"
                  value={memberReason}
                />
              )}
            </article>
          );
        })}
        {!busy && visible.length === 0 && (
          <p className="border border-dashed border-line py-14 text-center text-sm text-muted">
            이 분류에 표시할 회원이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
