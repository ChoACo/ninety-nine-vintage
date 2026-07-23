"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getPendingNicknameChangeRequests,
  reviewNicknameChangeRequest,
  type PendingNicknameChangeRequest,
} from "@/lib/supabase/nickname";

export function OwnerNicknameReviewPanel() {
  const [requests, setRequests] = useState<PendingNicknameChangeRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setRequests(await getPendingNicknameChangeRequests());
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "닉네임 요청을 불러오지 못했습니다.",
      );
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const review = async (
    request: PendingNicknameChangeRequest,
    approve: boolean,
  ) => {
    setBusyId(request.id);
    setNotice("");
    try {
      await reviewNicknameChangeRequest(request.id, approve);
      setNotice(approve ? "닉네임 변경을 승인했습니다." : "닉네임 변경을 반려했습니다.");
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "닉네임 요청을 처리하지 못했습니다.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="border border-line bg-surface p-5">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="eyebrow text-muted">회원 / 승인 대기</p>
          <h2 className="mt-2 text-xl font-black">닉네임 변경 승인</h2>
        </div>
        <span className="font-mono text-sm font-bold">{requests.length}</span>
      </div>
      <div className="divide-y divide-line">
        {requests.map((request) => (
          <article
            className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
            key={request.id}
          >
            <div>
              <p className="text-sm font-bold">
                {request.currentNickname} → {request.requestedNickname}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {new Date(request.requestedAt).toLocaleString("ko-KR")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="border border-line px-4 py-2 text-xs font-bold"
                disabled={busyId !== null}
                onClick={() => void review(request, false)}
                type="button"
              >
                반려
              </button>
              <button
                className="bg-ink px-4 py-2 text-xs font-bold text-paper"
                disabled={busyId !== null}
                onClick={() => void review(request, true)}
                type="button"
              >
                승인
              </button>
            </div>
          </article>
        ))}
        {requests.length === 0 && (
          <p className="py-8 text-center text-xs text-muted">
            승인 대기 중인 닉네임이 없습니다.
          </p>
        )}
      </div>
      {notice && <p className="mt-3 text-xs text-muted" role="status">{notice}</p>}
    </section>
  );
}
