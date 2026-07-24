"use client";

import { ExternalLink, MessageCircle, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface StorageItem {
  inventoryItemId: string;
  memberId: string;
  memberName: string;
  productId: string;
  title: string;
  imageUrl: string;
  originStoreId: string;
  originStoreName: string;
  fulfillmentStatus: "stored" | "waiting_outbound";
  shipmentRequested: boolean;
  storageStartedAt: string | null;
  storageExpiresAt: string | null;
}

interface WinnerItem {
  paymentOrderId: string | null;
  productId: string;
  title: string;
  imageUrl: string;
  originStoreId: string;
  originStoreName: string;
  amount: number;
  paymentStatus: "not_started" | "awaiting_manual_transfer";
}

interface StorageMember {
  memberId: string;
  memberName: string;
  items: StorageItem[];
}

interface WinnerMember {
  memberId: string;
  memberName: string;
  itemCount: number;
  totalAmount: number;
  latestWonAt: string;
  items: WinnerItem[];
}

interface ChatStore {
  id: string;
  name: string;
}

function formatAt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function OperationItemCard({
  item,
}: {
  item: StorageItem | WinnerItem;
}) {
  const storageItem = "inventoryItemId" in item ? item : null;
  const winnerItem = storageItem ? null : item as WinnerItem;
  return (
    <div className="border border-line bg-paper">
      <CatalogImage
        alt=""
        className="aspect-square w-full object-cover"
        loading="lazy"
        sizes="180px"
        src={item.imageUrl}
      />
      <div className="p-3">
        <p className="line-clamp-2 min-h-8 text-xs font-bold">{item.title}</p>
        <p className="mt-2 text-[10px] text-muted">{item.originStoreName}</p>
        {storageItem ? (
          <>
            <p className="mt-1 text-[10px] font-bold">
              {storageItem.fulfillmentStatus === "stored" ? "보관 완료" : "매장 출고 전"}
              {storageItem.shipmentRequested ? " · 배송 신청됨" : ""}
            </p>
            <p className="mt-1 text-[10px] text-muted">
              보관 {formatAt(storageItem.storageStartedAt)}<br />
              만료 {formatAt(storageItem.storageExpiresAt)}
            </p>
          </>
        ) : (
          <p className="mt-1 text-[10px] font-bold">
            {winnerItem?.amount.toLocaleString("ko-KR")}원 ·{" "}
            {winnerItem?.paymentStatus === "awaiting_manual_transfer"
              ? "입금 확인 대기"
              : "결제 신청 전"}
          </p>
        )}
        <Link
          className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold underline"
          href={`/auction/${item.productId}`}
        >
          상세보기 <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  );
}

export function OperatorMemberOperationsConsole({
  view,
}: {
  view: "storage" | "winners";
}) {
  const { session } = useSupabaseSession();
  const token = session?.access_token;
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [winnerMembers, setWinnerMembers] = useState<WinnerMember[]>([]);
  const [chatStores, setChatStores] = useState<ChatStore[]>([]);
  const [query, setQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/operator/member-operations?view=${view}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const payload = await response.json().catch(() => null) as {
        items?: StorageItem[];
        members?: WinnerMember[];
        chatStores?: ChatStore[];
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? payload?.error ?? "목록을 불러오지 못했습니다.");
      }
      setStorageItems(payload.items ?? []);
      setWinnerMembers(payload.members ?? []);
      setChatStores(payload.chatStores ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "목록을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [token, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const storageByMember = useMemo<StorageMember[]>(() => {
    const groups = new Map<string, StorageMember>();
    for (const item of storageItems) {
      const current = groups.get(item.memberId) ?? {
        memberId: item.memberId,
        memberName: item.memberName,
        items: [],
      };
      current.items.push(item);
      groups.set(item.memberId, current);
    }
    return [...groups.values()].sort((left, right) =>
      left.memberName.localeCompare(right.memberName, "ko-KR")
    );
  }, [storageItems]);

  const groups = useMemo<(StorageMember | WinnerMember)[]>(
    () => view === "storage" ? storageByMember : winnerMembers,
    [storageByMember, view, winnerMembers],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredGroups = useMemo(
    () => groups.filter((group) =>
      !normalizedQuery ||
      group.memberName.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
      group.memberId.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
      group.items.some((item) =>
        `${item.title} ${item.originStoreName}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery)
      )
    ),
    [groups, normalizedQuery],
  );
  const selectedGroup = groups.find((group) => group.memberId === selectedMemberId) ?? null;
  const chatStoreIds = useMemo(
    () => new Set(chatStores.map((store) => store.id)),
    [chatStores],
  );
  const chatStoresForGroup = useCallback(
    (group: StorageMember | WinnerMember) => {
      const seen = new Set<string>();
      return group.items.flatMap((item) => {
        if (
          seen.has(item.originStoreId) ||
          !chatStoreIds.has(item.originStoreId)
        ) {
          return [];
        }
        seen.add(item.originStoreId);
        return [{
          id: item.originStoreId,
          name: item.originStoreName,
        }];
      });
    },
    [chatStoreIds],
  );
  const selectedStorageByStore = useMemo(() => {
    if (view !== "storage" || !selectedGroup) return [];
    const byStore = new Map<string, {
      storeId: string;
      storeName: string;
      items: StorageItem[];
    }>();
    for (const item of selectedGroup.items as StorageItem[]) {
      const current = byStore.get(item.originStoreId) ?? {
        storeId: item.originStoreId,
        storeName: item.originStoreName,
        items: [],
      };
      current.items.push(item);
      byStore.set(item.originStoreId, current);
    }
    return [...byStore.values()].sort((left, right) =>
      left.storeName.localeCompare(right.storeName, "ko-KR")
    );
  }, [selectedGroup, view]);

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
        description={view === "storage"
          ? "회원별 보관 상품을 확인하고 상세 창에서 매장별로 나눠 봅니다."
          : "소속 매장의 입금 확인 전 낙찰 상품만 회원별로 확인합니다."}
        eyebrow="운영자 / 회원 상품"
        title={view === "storage" ? "회원 상품 보관함" : "낙찰된 회원"}
        variant="page"
      />

      <label className="flex items-center gap-3 border border-line bg-paper px-4 py-3">
        <Search aria-hidden="true" className="shrink-0 text-muted" size={16} />
        <span className="sr-only">회원 또는 상품 검색</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="회원명, 회원 ID, 상품명, 매장명 검색"
          type="search"
          value={query}
        />
        <span className="shrink-0 text-[10px] text-muted">{filteredGroups.length}명</span>
      </label>

      {notice && (
        <p className="border border-line bg-surface px-4 py-3 text-xs font-bold">
          {notice}
        </p>
      )}

      <div className="divide-y divide-line border-y border-line">
        {filteredGroups.map((group) => (
          <div
            className="flex w-full items-center justify-between gap-5 px-4 py-4 transition-colors hover:bg-surface"
            key={group.memberId}
          >
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => setSelectedMemberId(group.memberId)}
              type="button"
            >
              <span className="block truncate text-sm font-black">{group.memberName}</span>
              <span className="mt-1 block truncate font-mono text-[10px] text-muted">
                {group.memberId}
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-2">
              {chatStoresForGroup(group).map((store) => (
                <Link
                  aria-label={`${group.memberName}님과 ${store.name} 채팅`}
                  className="inline-flex h-9 items-center gap-1 border border-line bg-paper px-3 text-[10px] font-bold hover:border-ink"
                  href={`/admin/operator/chat?memberId=${encodeURIComponent(
                    group.memberId,
                  )}&storeId=${encodeURIComponent(store.id)}`}
                  key={store.id}
                >
                  <MessageCircle size={12} /> 채팅하기
                </Link>
              ))}
              <button
                className="text-right text-xs font-bold"
                onClick={() => setSelectedMemberId(group.memberId)}
                type="button"
              >
                상품 {group.items.length}개
                {view === "winners" && "totalAmount" in group && (
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    총 {group.totalAmount.toLocaleString("ko-KR")}원
                  </span>
                )}
              </button>
            </span>
          </div>
        ))}
        {!busy && filteredGroups.length === 0 && (
          <p className="py-16 text-center text-sm text-muted">
            {query.trim()
              ? "검색 조건에 맞는 회원이 없습니다."
              : view === "storage"
                ? "현재 보관 중인 회원 상품이 없습니다."
                : "소속 매장에 입금 확인 전 낙찰 정보가 없습니다."}
          </p>
        )}
      </div>

      <PremiumDialog
        labelledBy="operator-member-detail-title"
        onClose={() => setSelectedMemberId(null)}
        open={Boolean(selectedGroup)}
        panelClassName="max-w-5xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div className="min-w-0">
            <p className="eyebrow text-muted">
              {view === "storage" ? "회원 보관 상품 / 매장별 보기" : "입금 확인 전 낙찰 상품"}
            </p>
            <h2 className="mt-2 truncate text-xl font-black" id="operator-member-detail-title">
              {selectedGroup?.memberName}
            </h2>
            <p className="mt-1 break-all font-mono text-[10px] text-muted">
              {selectedGroup?.memberId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedGroup && chatStoresForGroup(selectedGroup).map((store) => (
              <Link
                className="inline-flex h-9 items-center gap-2 border border-line px-3 text-[10px] font-bold"
                href={`/admin/operator/chat?memberId=${encodeURIComponent(
                  selectedGroup.memberId,
                )}&storeId=${encodeURIComponent(store.id)}`}
                key={store.id}
              >
                <MessageCircle size={12} /> {store.name} 채팅
              </Link>
            ))}
            <button
              aria-label="회원 상세 창 닫기"
              className="p-2"
              onClick={() => setSelectedMemberId(null)}
              type="button"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-5">
          {view === "storage" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {selectedStorageByStore.map((store) => (
                <section className="min-w-0 border border-line bg-paper p-4" key={store.storeId}>
                  <div className="mb-3 flex items-end justify-between border-b border-ink pb-3">
                    <h3 className="text-sm font-black">{store.storeName}</h3>
                    <span className="text-[10px] text-muted">{store.items.length}개</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {store.items.map((item) => (
                      <OperationItemCard item={item} key={item.inventoryItemId} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(selectedGroup?.items as WinnerItem[] | undefined)?.map((item) => (
                <OperationItemCard
                  item={item}
                  key={item.paymentOrderId ?? item.productId}
                />
              ))}
            </div>
          )}
        </div>
      </PremiumDialog>
    </div>
  );
}
