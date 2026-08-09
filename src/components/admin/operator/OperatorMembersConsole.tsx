"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface Member {
  id: string;
  display_name: string;
  access_role: "band_member" | "member";
}

export function OperatorMembersConsole() {
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    const response = await fetch("/api/admin/operator/members?limit=500", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json() as {
      members?: Member[];
      message?: string;
      error?: string;
    };
    setBusy(false);
    if (!response.ok) {
      setNotice(payload.message ?? payload.error ?? "거래 회원을 불러오지 못했습니다.");
      return;
    }
    setMembers(payload.members ?? []);
  }, [accessToken]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="운영자 / 최소 조회"
        title="거래 회원"
        description="내 매장에서 실제 거래나 문의가 있었던 회원의 표시명만 확인합니다. 역할·경고·제재는 소유자만 관리합니다."
        variant="page"
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
      />
      {notice && (
        <p className="border border-line bg-surface px-4 py-3 text-xs font-bold" role="status">
          {notice}
        </p>
      )}
      <div className="grid gap-4">
        {members.map((member) => (
          <article className="border border-line bg-surface p-5" key={member.id}>
            <p className="font-bold">{member.display_name}</p>
            <p className="mt-2 text-xs text-muted">
              {member.access_role === "band_member" ? "밴드 회원" : "회원"} · 거래 지원용 최소 정보
            </p>
          </article>
        ))}
        {!busy && members.length === 0 && (
          <p className="border border-dashed border-line py-12 text-center text-sm text-muted">
            내 매장 거래 회원이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
