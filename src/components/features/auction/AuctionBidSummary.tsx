"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import type { AccountAuctionBidState, AuctionBidCapability } from "@/components/features/auction/auctionFeedLogic";

export type { AccountAuctionBidState } from "@/components/features/auction/auctionFeedLogic";

export interface AccountAuctionBidItem {
  amount: number;
  currentPrice: number;
  productId: string;
  productStatus: string;
  state: AccountAuctionBidState;
}

export interface AuctionBidSummaryValue {
  final: number;
  leading: number;
  outbid: number;
  total: number;
}

interface AccountAuctionBidPayload {
  bidCapability?: "eligible_member";
  error?: string;
  items?: AccountAuctionBidItem[];
  summary?: AuctionBidSummaryValue;
}

export interface AccountAuctionBidSnapshot {
  capability: AuctionBidCapability;
  error: boolean;
  items: readonly AccountAuctionBidItem[];
  loading: boolean;
  refresh: () => void;
  signedIn: boolean;
  summary: AuctionBidSummaryValue | null;
}

export function useAccountAuctionBids(enabled = true): AccountAuctionBidSnapshot {
  const { loading: sessionLoading, revision, session } = useSupabaseSession();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [result, setResult] = useState<{
    capability: Extract<AuctionBidCapability, "eligible_member" | "non_member" | "unavailable">;
    error: boolean;
    payload: AccountAuctionBidPayload;
    revision: number;
    userId: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !session?.access_token) return;
    const controller = new AbortController();
    const sessionRevision = revision;
    const userId = session.user.id;
    void (async () => {
      try {
        const response = await fetch("/api/account/bids", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const responsePayload = await response.json().catch(() => ({})) as AccountAuctionBidPayload;
        const capability = response.ok
          ? "eligible_member"
          : response.status === 403 && responsePayload.error === "member_required"
            ? "non_member"
            : "unavailable";
        const payload = response.ok ? responsePayload : {};
        if (!controller.signal.aborted) {
          setResult({ capability, error: capability === "unavailable", payload, revision: sessionRevision, userId });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ capability: "unavailable", error: true, payload: {}, revision: sessionRevision, userId });
        }
      }
    })();
    return () => controller.abort();
  }, [enabled, refreshNonce, revision, session]);

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);
  const isCurrent = Boolean(
    result &&
    result.revision === revision &&
    result.userId === session?.user.id,
  );
  const payload = isCurrent ? result?.payload : null;
  const signedIn = Boolean(session);
  const capability: AuctionBidCapability = !enabled || (!sessionLoading && !signedIn)
    ? "guest"
    : sessionLoading || (signedIn && !isCurrent)
      ? "checking"
      : result?.capability ?? "unavailable";

  return {
    capability,
    error: isCurrent ? Boolean(result?.error) : false,
    items: payload?.items ?? [],
    loading: enabled && capability === "checking",
    refresh,
    signedIn,
    summary: payload?.summary ?? null,
  };
}

export function AuctionBidSummary({ snapshot }: { snapshot: AccountAuctionBidSnapshot }) {
  const { capability, error, loading, summary } = snapshot;

  return (
    <div className="mb-6 border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.14em] text-muted">내 입찰 · 실시간 현황</p>
          <p className="mt-1 text-xs font-bold">
            {loading
              ? "내 입찰 현황을 확인하고 있습니다."
              : capability === "eligible_member"
                ? "내 입찰 현황"
                : capability === "non_member"
                  ? "현재 로그인한 계정은 경매 입찰용 회원 계정이 아닙니다."
                  : error || capability === "unavailable"
                    ? "입찰 자격과 현황을 잠시 확인하지 못했습니다."
                    : "카카오 로그인 후 입찰 현황을 확인하세요."}
          </p>
        </div>
        {capability === "guest"
          ? <Link className="shrink-0 text-[10px] font-bold underline" href="/account/login?next=%2Ffeed">로그인</Link>
          : capability === "eligible_member"
            ? <Link className="shrink-0 text-[10px] font-bold underline" href="/account#bids">전체 보기</Link>
            : <span className="shrink-0 text-[10px] font-bold text-muted">{capability === "non_member" ? "회원 전용" : "확인 중"}</span>}
      </div>
      {capability === "eligible_member" && summary && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[10px] text-muted"><span>참여 {summary.total}</span><span className="font-bold text-emerald-700">최고 입찰 {summary.leading}</span><span>낙찰·결제 {summary.final}</span>{summary.outbid > 0 && <span className="font-bold text-amber-700">확인 필요 {summary.outbid}</span>}</div>}
    </div>
  );
}
