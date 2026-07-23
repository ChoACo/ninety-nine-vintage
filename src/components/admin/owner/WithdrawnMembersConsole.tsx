"use client";

import { ArrowLeft, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import type { WithdrawnMemberRetention } from "@/lib/memberManagement/contracts";

const statusLabels: Record<
  WithdrawnMemberRetention["retention_status"],
  string
> = {
  retained: "보관 중",
  due: "정리 대기",
  failed: "정리 재시도 필요",
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "없음";
}

export function WithdrawnMembersConsole() {
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const [members, setMembers] = useState<WithdrawnMemberRetention[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch(
        "/api/admin/owner/members/withdrawn?limit=500",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        members?: WithdrawnMemberRetention[];
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ??
            payload.error ??
            "탈퇴 회원 보관 목록을 불러오지 못했습니다.",
        );
      }
      setMembers(payload.members ?? []);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "탈퇴 회원 보관 목록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const counts = useMemo(
    () =>
      members.reduce(
        (result, member) => {
          result[member.retention_status] += 1;
          return result;
        },
        { retained: 0, due: 0, failed: 0 },
      ),
    [members],
  );

  async function retryCleanup(member: WithdrawnMemberRetention) {
    if (!accessToken || pendingMemberId) return;
    setPendingMemberId(member.member_id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/members/withdrawn", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "retry_cleanup",
          memberId: member.member_id,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "회원 기록을 정리하지 못했습니다.",
        );
      }
      await load();
      setNotice("보관기한이 지난 익명 회원 기록을 정리했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "회원 기록을 정리하지 못했습니다.",
      );
    } finally {
      setPendingMemberId(null);
    }
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        action={(
          <span className="flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold"
              href="/admin/owner/members"
            >
              <ArrowLeft size={13} /> 회원 관리
            </Link>
            <button
              className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
              disabled={loading}
              onClick={() => void load()}
              type="button"
            >
              <RefreshCw size={13} /> 새로고침
            </button>
          </span>
        )}
        description="탈퇴 회원은 즉시 회원 목록에서 제외되고 개인정보가 제거됩니다. 익명 참조만 7일 보관한 뒤 자동 정리됩니다."
        eyebrow="소유자 / 회원·권한"
        title="탈퇴 회원 보관함"
        variant="page"
      />

      <div className="grid grid-cols-3 border border-line bg-surface">
        {(
          [
            ["retained", "보관 중"],
            ["due", "정리 대기"],
            ["failed", "재시도 필요"],
          ] as const
        ).map(([status, label]) => (
          <div
            className="border-r border-line p-4 text-center last:border-r-0"
            key={status}
          >
            <p className="text-[10px] font-bold text-muted">{label}</p>
            <p className="mt-1 font-mono text-xl font-black">
              {counts[status]}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4">
        {members.map((member) => {
          const canRetry = member.retention_status !== "retained";
          const pending = pendingMemberId === member.member_id;
          return (
            <article
              aria-busy={pending}
              className="border border-line bg-surface p-5"
              key={member.member_id}
            >
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">
                      익명 회원 {member.anonymized_reference.slice(-8)}
                    </p>
                    <span className="border border-line px-2 py-1 text-[10px] font-bold">
                      {statusLabels[member.retention_status]}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[10px] text-muted">
                    참조 {member.anonymized_reference}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    탈퇴 {formatDateTime(member.deleted_at)} · 정리 예정{" "}
                    {formatDateTime(member.purge_due_at)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    처리 사유: {member.deletion_reason}
                  </p>
                  {member.attempt_count > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      정리 시도 {member.attempt_count}회 · 마지막 시도{" "}
                      {formatDateTime(member.last_attempt_at)}
                      {member.last_error_code
                        ? ` · 오류 ${member.last_error_code}`
                        : ""}
                    </p>
                  )}
                </div>
                <button
                  className="inline-flex shrink-0 items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!canRetry || Boolean(pendingMemberId)}
                  onClick={() => void retryCleanup(member)}
                  type="button"
                >
                  <RotateCcw size={13} />
                  {pending ? "정리 중" : "정리 재시도"}
                </button>
              </div>
            </article>
          );
        })}

        {!loading && members.length === 0 && (
          <p className="border border-dashed border-line py-14 text-center text-sm text-muted">
            보관 중인 탈퇴 회원 기록이 없습니다.
          </p>
        )}
      </div>

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
