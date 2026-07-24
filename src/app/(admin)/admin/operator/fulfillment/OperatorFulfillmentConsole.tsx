"use client";

import { CalendarDays, CheckSquare2, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";

type Action = "store_paid_items" | "store_requested_items";

interface Item {
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string;
  version: number;
  requestedForShipping: boolean;
  isBlocked: boolean;
}

interface BuyerGroup {
  groupId: string;
  action: Action;
  workId: string | null;
  workVersion: number | null;
  activityDate: string;
  buyerId: string;
  buyerName: string;
  originStoreId: string;
  originStoreName: string;
  canProcess: boolean;
  items: Item[];
}

interface QueuePayload {
  groups?: BuyerGroup[];
  hasMore?: boolean;
  message?: string;
  error?: string;
}

const PAGE_SIZE = 24;
const labels: Record<Action, string> = {
  store_paid_items: "결제 상품 출고·보관",
  store_requested_items: "배송 신청 상품 출고·보관",
};

export function OperatorFulfillmentConsole() {
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const [groups, setGroups] = useState<BuyerGroup[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [date, setDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (nextOffset = offset, nextDate = date) => {
    if (!accessToken) return;
    setBusy(true);
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(nextOffset),
      ...(nextDate ? { date: nextDate } : {}),
    });
    const response = await fetch(`/api/admin/operator/fulfillment?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json() as QueuePayload;
    setBusy(false);
    if (!response.ok) {
      setNotice(payload.message ?? payload.error ?? "상품 보관 목록을 불러오지 못했습니다.");
      return;
    }
    setGroups(payload.groups ?? []);
    setHasMore(Boolean(payload.hasMore));
  }, [accessToken, date, offset]);

  useEffect(() => {
    queueMicrotask(() => void load(0, ""));
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  async function process(group: BuyerGroup) {
    if (!accessToken) return;
    const chosen = selected[group.groupId] ?? [];
    const items = group.items.filter((item) => chosen.includes(item.inventoryItemId));
    if (items.length === 0) return;
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/admin/operator/fulfillment", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        action: group.action,
        workId: group.workId,
        expectedWorkVersion: group.workVersion,
        inventoryItemIds: items.map((item) => item.inventoryItemId),
        expectedVersions: items.map((item) => item.version),
        idempotencyKey: crypto.randomUUID(),
        note: notes[group.groupId] ?? "",
      }),
    });
    const payload = await response.json() as { message?: string; error?: string };
    setBusy(false);
    if (!response.ok) {
      setNotice(payload.message ?? payload.error ?? "상품 보관 처리를 완료하지 못했습니다.");
      return;
    }
    setNotice(`${group.buyerName}님의 선택 상품을 출고 즉시 보관 처리했습니다.`);
    setSelected((current) => ({ ...current, [group.groupId]: [] }));
    await load();
  }

  function changePage(nextOffset: number) {
    setOffset(nextOffset);
    void load(nextOffset, date);
  }

  function applyDate(nextDate: string) {
    setDate(nextDate);
    setOffset(0);
    void load(0, nextDate);
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        action={(
          <button className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold" onClick={() => void load()} type="button">
            <RefreshCw size={13} /> 새로고침
          </button>
        )}
        description="매장에서 상품을 내보내는 즉시 보관 완료로 처리합니다. 날짜별 페이지와 상품 그리드로 필요한 작업만 빠르게 확인할 수 있습니다."
        eyebrow="매장 상품 업무"
        title="출고·보관"
        variant="page"
      />

      {notice && <p className="border border-line bg-surface px-4 py-3 text-xs font-bold" role="status">{notice}</p>}

      <div className="flex flex-col justify-between gap-3 border border-line p-4 sm:flex-row sm:items-center">
        <label className="flex items-center gap-3 text-xs font-bold">
          <CalendarDays size={15} />
          작업 날짜
          <input
            className="border border-line bg-paper px-3 py-2"
            onChange={(event) => applyDate(event.target.value)}
            type="date"
            value={date}
          />
        </label>
        {date && <button className="text-xs font-bold underline" onClick={() => applyDate("")} type="button">전체 날짜 보기</button>}
      </div>

      <div className="grid gap-6">
        {groups.map((group) => {
          const available = group.items.filter((item) => !item.isBlocked);
          const chosen = selected[group.groupId] ?? [];
          const all = available.length > 0 && available.every((item) => chosen.includes(item.inventoryItemId));
          return (
            <article className="border border-line" key={group.groupId}>
              <header className="flex flex-col justify-between gap-3 border-b border-line bg-surface p-5 sm:flex-row">
                <div>
                  <p className="text-sm font-black">{group.buyerName}</p>
                  <p className="mt-1 text-xs text-muted">{group.originStoreName} · {group.activityDate}</p>
                </div>
                <div className="sm:text-right">
                  <span className="border border-line bg-paper px-2 py-1 text-[10px] font-bold">{labels[group.action]}</span>
                  <p className={`mt-2 text-[10px] font-bold ${group.canProcess ? "text-emerald-700" : "text-muted"}`}>
                    {group.canProcess ? "이 매장 처리 가능" : "조회 전용"}
                  </p>
                </div>
              </header>

              <div className="p-5">
                <label className="mb-4 flex items-center gap-2 text-xs font-bold">
                  <input
                    checked={all}
                    disabled={!group.canProcess || available.length === 0}
                    onChange={(event) => setSelected((current) => ({
                      ...current,
                      [group.groupId]: event.target.checked ? available.map((item) => item.inventoryItemId) : [],
                    }))}
                    type="checkbox"
                  />
                  처리 가능한 상품 전체 선택
                </label>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {group.items.map((item) => {
                    const disabled = !group.canProcess || item.isBlocked;
                    const checked = chosen.includes(item.inventoryItemId);
                    return (
                      <div className={`relative border border-line bg-paper ${disabled ? "opacity-50" : ""}`} key={item.inventoryItemId}>
                        <label className="absolute left-2 top-2 z-10 grid size-7 cursor-pointer place-items-center bg-paper/95 shadow-sm">
                          <input
                            aria-label={`${item.title} 선택`}
                            checked={checked}
                            disabled={disabled}
                            onChange={(event) => setSelected((current) => ({
                              ...current,
                              [group.groupId]: event.target.checked
                                ? [...(current[group.groupId] ?? []), item.inventoryItemId]
                                : (current[group.groupId] ?? []).filter((id) => id !== item.inventoryItemId),
                            }))}
                            type="checkbox"
                          />
                        </label>
                        <div className="aspect-square bg-surface">
                          {item.imageUrl
                            ? <CatalogImage alt="" className="h-full w-full object-cover" loading="lazy" sizes="180px" src={item.imageUrl} />
                            : <div className="grid h-full place-items-center text-[10px] text-muted">사진 없음</div>}
                        </div>
                        <div className="p-3">
                          <p className="line-clamp-2 min-h-8 text-xs font-bold">{item.title}</p>
                          <p className="mt-2 text-[10px] text-muted">{item.requestedForShipping ? "배송 신청 포함" : "결제 완료"}</p>
                          {item.isBlocked && <p className="mt-1 text-[10px] font-bold text-amber-700">확인 필요</p>}
                          <Link className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold underline" href={`/auction/${item.productId}`}>
                            상품 상세보기 <ExternalLink size={10} />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <input
                    aria-label={`${group.buyerName} 처리 메모`}
                    className="border border-line bg-paper px-3 py-2 text-xs sm:min-w-72"
                    onChange={(event) => setNotes((current) => ({ ...current, [group.groupId]: event.target.value }))}
                    placeholder="메모 (선택)"
                    value={notes[group.groupId] ?? ""}
                  />
                  <button
                    className="inline-flex items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40"
                    disabled={busy || chosen.length === 0}
                    onClick={() => void process(group)}
                    type="button"
                  >
                    <CheckSquare2 size={14} /> 선택 상품 출고·보관 완료
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!busy && groups.length === 0 && (
          <p className="border border-dashed border-line py-14 text-center text-sm text-muted">현재 처리할 상품이 없습니다.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} type="button">이전</button>
        <p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + groups.length}</p>
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={!hasMore} onClick={() => changePage(offset + PAGE_SIZE)} type="button">다음</button>
      </div>
    </div>
  );
}
