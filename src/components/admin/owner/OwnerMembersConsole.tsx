"use client";

import {
  Archive,
  Gavel,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OwnerNicknameReviewPanel } from "@/components/admin/owner/OwnerNicknameReviewPanel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import type {
  ManagedMember,
  ManagedMemberSanction,
  ManagedMemberStatus,
} from "@/lib/memberManagement/contracts";

type MemberSegment = "all" | "active" | "suspended";

type ActionDialogState =
  | { kind: "status"; member: ManagedMember; status: ManagedMemberStatus }
  | { kind: "warning"; member: ManagedMember }
  | { kind: "sanction_create"; member: ManagedMember }
  | {
      kind: "sanction_update";
      member: ManagedMember;
      sanction: ManagedMemberSanction;
    }
  | {
      kind: "sanction_cancel";
      member: ManagedMember;
      sanction: ManagedMemberSanction;
    }
  | {
      kind: "enforcement_clear";
      member: ManagedMember;
      scope: "warnings" | "sanctions";
    }
  | { kind: "delete"; member: ManagedMember };

const segmentLabels: Record<MemberSegment, string> = {
  all: "전체",
  active: "활성",
  suspended: "정지",
};

const roleLabels = {
  owner: "소유자",
  operator: "운영자",
  employee: "직원",
  band_member: "밴드 회원",
  member: "회원",
} as const;

function segmentForMember(
  member: ManagedMember,
): Exclude<MemberSegment, "all"> {
  return member.account_status === "suspended" ||
    member.account_status === "temporary_suspended"
    ? "suspended"
    : "active";
}

function localDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function dialogCopy(dialog: ActionDialogState) {
  if (dialog.kind === "status") {
    if (dialog.status === "active") {
      return {
        title: `${dialog.member.display_name} 계정 활성화`,
        description: "정지 상태와 만료 시각을 제거하고 계정 이용을 다시 허용합니다.",
        submitLabel: "활성화",
        destructive: false,
      };
    }
    if (dialog.status === "suspended") {
      return {
        title: `${dialog.member.display_name} 계정 정지`,
        description: "해제 전까지 계정 이용을 무기한 중단합니다.",
        submitLabel: "정지",
        destructive: true,
      };
    }
    return {
      title: `${dialog.member.display_name} 계정 일시 정지`,
      description: "선택한 만료 시각까지 계정 이용을 중단합니다.",
      submitLabel: "일시 정지",
      destructive: true,
    };
  }
  if (dialog.kind === "warning") {
    return {
      title: `${dialog.member.display_name} 경고 등록`,
      description: "회원 경고를 한 건 추가합니다.",
      submitLabel: "경고 등록",
      destructive: true,
    };
  }
  if (dialog.kind === "sanction_create") {
    return {
      title: `${dialog.member.display_name} 24시간 제재`,
      description: "DB 처리 시각부터 정확히 24시간 동안 입찰을 제한합니다.",
      submitLabel: "24시간 제재",
      destructive: true,
    };
  }
  if (dialog.kind === "sanction_update") {
    return {
      title: `${dialog.member.display_name} 제재 연장`,
      description: "현재 종료 시각에서 24시간을 연장합니다.",
      submitLabel: "24시간 연장",
      destructive: true,
    };
  }
  if (dialog.kind === "sanction_cancel") {
    return {
      title: `${dialog.member.display_name} 제재 취소`,
      description: "선택한 활성 제재를 즉시 종료합니다.",
      submitLabel: "제재 취소",
      destructive: false,
    };
  }
  if (dialog.kind === "enforcement_clear") {
    return {
      title: `${dialog.member.display_name} ${
        dialog.scope === "warnings" ? "경고" : "제재"
      } 누적 삭제`,
      description: "관련 이력과 현재 입찰 제한을 함께 제거합니다.",
      submitLabel: "누적 삭제",
      destructive: true,
    };
  }
  return {
    title: `${dialog.member.display_name} 탈퇴 처리`,
    description:
      "인증 계정과 개인정보를 제거하고 익명 기록을 7일 보관한 뒤 자동 정리합니다.",
    submitLabel: "탈퇴 처리",
    destructive: true,
  };
}

export function OwnerMembersConsole() {
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [segment, setSegment] = useState<MemberSegment>("active");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingMemberIds, setPendingMemberIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [operatorDrafts, setOperatorDrafts] = useState<Record<string, string>>(
    {},
  );
  const [dialog, setDialog] = useState<ActionDialogState | null>(null);
  const [dialogReason, setDialogReason] = useState("");
  const [dialogUntil, setDialogUntil] = useState("");
  const [dialogMinimumUntil, setDialogMinimumUntil] = useState("");
  const [dialogError, setDialogError] = useState("");

  const load = useCallback(
    async (showLoading = true) => {
      if (!accessToken) return;
      if (showLoading) setLoading(true);
      try {
        const response = await fetch("/api/admin/owner/members?limit=500", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          members?: ManagedMember[];
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.message ??
              payload.error ??
              "회원 목록을 불러오지 못했습니다.",
          );
        }
        setMembers(payload.members ?? []);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "회원 목록을 불러오지 못했습니다.",
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const counts = useMemo(() => {
    const next = { all: members.length, active: 0, suspended: 0 };
    for (const member of members) next[segmentForMember(member)] += 1;
    return next;
  }, [members]);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return members.filter((member) => {
      if (segment !== "all" && segmentForMember(member) !== segment) {
        return false;
      }
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
    () => members.filter((member) => member.access_role === "operator"),
    [members],
  );

  async function mutate(
    body: Record<string, unknown>,
    success: string,
  ): Promise<boolean> {
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    if (!accessToken || !memberId || pendingMemberIds.includes(memberId)) {
      return false;
    }
    setPendingMemberIds((current) => [...current, memberId]);
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
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "요청을 처리하지 못했습니다.",
        );
      }
      setNotice(success);
      await load(false);
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "요청을 처리하지 못했습니다.",
      );
      return false;
    } finally {
      setPendingMemberIds((current) =>
        current.filter((id) => id !== memberId)
      );
    }
  }

  function openDialog(nextDialog: ActionDialogState) {
    setDialog(nextDialog);
    setDialogReason("");
    setDialogError("");
    setDialogMinimumUntil(localDateTimeValue(new Date(Date.now() + 60_000)));
    setDialogUntil(
      nextDialog.kind === "status" &&
          nextDialog.status === "temporary_suspended"
        ? localDateTimeValue(new Date(Date.now() + 86_400_000))
        : "",
    );
  }

  async function submitDialog() {
    if (!dialog) return;
    const reason = dialogReason.trim();
    if (!reason) {
      setDialogError("처리 사유를 입력해 주세요.");
      return;
    }
    let body: Record<string, unknown>;
    let success: string;

    if (dialog.kind === "status") {
      let suspendedUntil: string | null = null;
      if (dialog.status === "temporary_suspended") {
        const parsed = new Date(dialogUntil);
        if (!dialogUntil || Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
          setDialogError("현재 이후의 일시 정지 만료 시각을 선택해 주세요.");
          return;
        }
        suspendedUntil = parsed.toISOString();
      }
      body = {
        action: "status",
        memberId: dialog.member.id,
        status: dialog.status,
        suspendedUntil,
        reason,
      };
      success = dialog.status === "active"
        ? "계정을 활성화했습니다."
        : dialog.status === "suspended"
          ? "계정을 무기한 정지했습니다."
          : "계정을 일시 정지했습니다.";
    } else if (dialog.kind === "warning") {
      body = {
        action: "warning",
        memberId: dialog.member.id,
        category: "manual",
        reason,
      };
      success = "경고를 추가했습니다.";
    } else if (dialog.kind === "sanction_create") {
      body = {
        action: "sanction_create",
        memberId: dialog.member.id,
        reason,
      };
      success = "24시간 제재를 추가했습니다.";
    } else if (dialog.kind === "sanction_update") {
      body = {
        action: "sanction_update",
        memberId: dialog.member.id,
        sanctionId: dialog.sanction.id,
        endsAt: new Date(
          Math.max(Date.now(), new Date(dialog.sanction.endsAt).getTime()) +
            86_400_000,
        ).toISOString(),
        reason,
      };
      success = "제재를 24시간 연장했습니다.";
    } else if (dialog.kind === "sanction_cancel") {
      body = {
        action: "sanction_cancel",
        memberId: dialog.member.id,
        sanctionId: dialog.sanction.id,
        reason,
      };
      success = "제재를 취소했습니다.";
    } else if (dialog.kind === "enforcement_clear") {
      body = {
        action: "enforcement_clear",
        memberId: dialog.member.id,
        scope: dialog.scope,
        reason,
      };
      success = dialog.scope === "warnings"
        ? "경고 누적을 삭제했습니다."
        : "제재 누적을 삭제했습니다.";
    } else {
      body = {
        action: "delete",
        memberId: dialog.member.id,
        reason,
      };
      success = "계정을 익명화하고 탈퇴 처리했습니다.";
    }

    const succeeded = await mutate(body, success);
    if (succeeded) setDialog(null);
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        action={(
          <span className="flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold"
              href="/admin/owner/members/withdrawn"
            >
              <Archive size={13} /> 탈퇴 보관함
            </Link>
            <button
              className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold"
              disabled={loading}
              onClick={() => void load()}
              type="button"
            >
              <RefreshCw size={13} /> 새로고침
            </button>
          </span>
        )}
        description="활성·정지 계정을 분리해 보고 역할, 연락처와 제재를 관리합니다. 탈퇴 계정은 별도 보관함에서 7일간 익명 보관됩니다."
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
          <p className="shrink-0 font-mono text-sm font-bold">
            {visible.length}명
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {visible.map((member) => {
          const owner = member.access_role === "owner";
          const phone = phones[member.id] ?? member.phone ?? "";
          const roleDraft =
            roleDrafts[member.id] ?? member.access_role ?? "member";
          const operatorDraft =
            operatorDrafts[member.id] ?? member.reports_to_operator_id ?? "";
          const canManageCredits =
            member.access_role !== "operator" &&
            member.access_role !== "owner";
          const canManageEnforcement =
            member.access_role === "band_member" ||
            member.access_role === "member";
          const memberBusy = pendingMemberIds.includes(member.id);

          return (
            <article
              aria-busy={memberBusy}
              className="border border-line bg-surface p-5"
              key={member.id}
            >
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserRound size={15} />
                    <p className="font-bold">
                      {member.display_name || "이름 없음"}
                    </p>
                    <span className="border border-line px-2 py-1 text-[10px]">
                      {roleLabels[member.access_role] ?? "역할 없음"}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[10px] text-muted">
                    ID {member.id}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {member.email ?? "이메일 없음"} ·{" "}
                    {member.phone ?? "연락처 없음"} · 배송지{" "}
                    {member.address_count} · 입찰 {member.bid_count}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    상태 {member.account_status} · 경고 {member.warning_count} ·
                    제재 {member.sanction_count}
                    {member.suspended_until
                      ? ` · ${new Date(member.suspended_until).toLocaleString(
                          "ko-KR",
                        )}까지`
                      : ""}
                  </p>
                </div>

                {!owner && (
                  <div className="grid min-w-64 gap-2">
                    <select
                      aria-label={`${member.display_name} 역할`}
                      className="border border-line bg-paper px-3 py-2 text-xs"
                      disabled={memberBusy}
                      onChange={(event) =>
                        setRoleDrafts((current) => ({
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
                        disabled={memberBusy}
                        onChange={(event) =>
                          setOperatorDrafts((current) => ({
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
                      disabled={
                        memberBusy ||
                        (roleDraft === "employee" && !operatorDraft)
                      }
                      onClick={() =>
                        void mutate(
                          {
                            action: "role",
                            memberId: member.id,
                            roleCode: roleDraft,
                            reportsToOperatorId:
                              roleDraft === "employee" ? operatorDraft : null,
                          },
                          "역할과 담당 운영자를 저장했습니다.",
                        )}
                      type="button"
                    >
                      역할 저장
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <input
                  aria-label={`${member.display_name} 연락처`}
                  className="border border-line bg-paper px-3 py-2 text-xs"
                  onChange={(event) =>
                    setPhones((current) => ({
                      ...current,
                      [member.id]: event.target.value,
                    }))}
                  value={phone}
                />
                <button
                  className="inline-flex items-center justify-center gap-1 border border-line px-3 py-2 text-xs font-bold"
                  disabled={memberBusy}
                  onClick={() =>
                    void mutate(
                      {
                        action: "profile",
                        memberId: member.id,
                        phone,
                      },
                      "연락처를 저장했습니다.",
                    )}
                  type="button"
                >
                  <Save size={12} /> 연락처 저장
                </button>
                {canManageCredits && (
                  <>
                    <button
                      className="border border-line px-3 py-2 text-xs font-bold"
                      disabled={memberBusy}
                      onClick={() =>
                        void mutate(
                          {
                            action: "credits",
                            memberId: member.id,
                            delta: 1,
                          },
                          "배송권을 1장 추가했습니다.",
                        )}
                      type="button"
                    >
                      배송권 +1
                    </button>
                    <button
                      className="border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
                      disabled={
                        memberBusy || (member.shipping_credit_count ?? 0) < 1
                      }
                      onClick={() =>
                        void mutate(
                          {
                            action: "credits",
                            memberId: member.id,
                            delta: -1,
                          },
                          "배송권을 1장 차감했습니다.",
                        )}
                      type="button"
                    >
                      배송권 -1
                    </button>
                  </>
                )}
              </div>

              {owner ? (
                <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                  소유자 계정은 사이트 접근 상실을 방지하기 위해 정지·제재·탈퇴
                  대상에서 보호됩니다.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    <button
                      className="border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
                      disabled={memberBusy || member.account_status === "active"}
                      onClick={() =>
                        openDialog({
                          kind: "status",
                          member,
                          status: "active",
                        })}
                      type="button"
                    >
                      활성
                    </button>
                    <button
                      className="border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
                      disabled={
                        memberBusy || member.account_status === "suspended"
                      }
                      onClick={() =>
                        openDialog({
                          kind: "status",
                          member,
                          status: "suspended",
                        })}
                      type="button"
                    >
                      정지
                    </button>
                    <button
                      className="border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
                      disabled={memberBusy}
                      onClick={() =>
                        openDialog({
                          kind: "status",
                          member,
                          status: "temporary_suspended",
                        })}
                      type="button"
                    >
                      일시 정지
                    </button>
                    {canManageEnforcement && (
                      <>
                        <button
                          className="border border-line px-3 py-2 text-xs font-bold"
                          disabled={memberBusy}
                          onClick={() =>
                            openDialog({ kind: "warning", member })}
                          type="button"
                        >
                          경고
                        </button>
                        <button
                          className="inline-flex items-center justify-center gap-1 bg-ink px-3 py-2 text-xs font-bold text-paper"
                          disabled={memberBusy}
                          onClick={() =>
                            openDialog({ kind: "sanction_create", member })}
                          type="button"
                        >
                          <Gavel size={12} /> 24시간 제재
                        </button>
                      </>
                    )}
                    <button
                      className="ml-auto inline-flex items-center justify-center gap-1 bg-rose-700 px-3 py-2 text-xs font-bold text-white"
                      disabled={memberBusy}
                      onClick={() => openDialog({ kind: "delete", member })}
                      type="button"
                    >
                      <Trash2 size={12} /> 탈퇴 처리
                    </button>
                  </div>

                  {canManageEnforcement && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="mr-auto text-muted">
                        누적 삭제는 관련 이력과 현재 입찰 제한을 함께 제거합니다.
                      </span>
                      <button
                        className="border border-line px-3 py-2 font-bold disabled:opacity-40"
                        disabled={memberBusy || member.warning_count < 1}
                        onClick={() =>
                          openDialog({
                            kind: "enforcement_clear",
                            member,
                            scope: "warnings",
                          })}
                        type="button"
                      >
                        경고 누적 삭제
                      </button>
                      <button
                        className="border border-rose-300 px-3 py-2 font-bold text-rose-700 disabled:opacity-40"
                        disabled={memberBusy || member.sanction_count < 1}
                        onClick={() =>
                          openDialog({
                            kind: "enforcement_clear",
                            member,
                            scope: "sanctions",
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
                            <b>
                              {new Date(sanction.endsAt).toLocaleString("ko-KR")}
                              까지
                            </b>
                            {" · "}
                            {sanction.reason ?? "사유 없음"} · {sanction.source}
                          </span>
                          <span className="flex gap-2">
                            <button
                              className="border border-line px-3 py-2 font-bold"
                              disabled={memberBusy}
                              onClick={() =>
                                openDialog({
                                  kind: "sanction_update",
                                  member,
                                  sanction,
                                })}
                              type="button"
                            >
                              24시간 연장
                            </button>
                            <button
                              className="border border-rose-600 px-3 py-2 font-bold text-rose-700"
                              disabled={memberBusy}
                              onClick={() =>
                                openDialog({
                                  kind: "sanction_cancel",
                                  member,
                                  sanction,
                                })}
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
            </article>
          );
        })}
        {!loading && visible.length === 0 && (
          <p className="border border-dashed border-line py-14 text-center text-sm text-muted">
            이 분류에 표시할 회원이 없습니다.
          </p>
        )}
      </div>

      {dialog && (
        <div
          aria-labelledby="member-action-title"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
        >
          <form
            className="w-full max-w-lg border border-line bg-paper p-6 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDialog();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black" id="member-action-title">
                  {dialogCopy(dialog).title}
                </h2>
                <p className="mt-2 text-xs text-muted">
                  {dialogCopy(dialog).description}
                </p>
              </div>
              <button
                aria-label="팝업 닫기"
                className="p-2"
                onClick={() => setDialog(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <label className="mt-6 block text-xs font-bold">
              처리 사유
              <textarea
                autoFocus
                className="mt-2 min-h-28 w-full resize-y border border-line bg-surface p-3 text-sm font-normal"
                maxLength={500}
                onChange={(event) => {
                  setDialogReason(event.target.value);
                  setDialogError("");
                }}
                placeholder="1~500자로 입력해 주세요."
                value={dialogReason}
              />
            </label>

            {dialog.kind === "status" &&
              dialog.status === "temporary_suspended" && (
                <label className="mt-4 block text-xs font-bold">
                  일시 정지 만료 시각
                  <input
                    className="mt-2 w-full border border-line bg-surface px-3 py-3 text-sm font-normal"
                    min={dialogMinimumUntil}
                    onChange={(event) => {
                      setDialogUntil(event.target.value);
                      setDialogError("");
                    }}
                    type="datetime-local"
                    value={dialogUntil}
                  />
                </label>
              )}

            {dialogError && (
              <p className="mt-3 text-xs font-bold text-rose-700" role="alert">
                {dialogError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="border border-line px-4 py-3 text-xs font-bold"
                onClick={() => setDialog(null)}
                type="button"
              >
                취소
              </button>
              <button
                className={
                  dialogCopy(dialog).destructive
                    ? "bg-rose-700 px-4 py-3 text-xs font-bold text-white"
                    : "bg-ink px-4 py-3 text-xs font-bold text-paper"
                }
                disabled={pendingMemberIds.includes(dialog.member.id)}
                type="submit"
              >
                {dialogCopy(dialog).submitLabel}
              </button>
            </div>
          </form>
        </div>
      )}

      {notice && (
        <p
          className="fixed bottom-6 right-6 z-[120] max-w-md border border-line bg-ink px-5 py-4 text-xs font-bold text-paper shadow-xl"
          role="status"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
