"use client";

import type { AuctionPost } from "@/src/types/auction";
import FeedList from "@/src/components/feed/FeedList";
import { EditorialCatalogSidebar } from "@/src/components/feed/EditorialCatalogSidebar";

interface EditorialCatalogHomeProps {
  posts: AuctionPost[];
  currentUserName: string;
  currentUserId?: string | null;
  onBid: (postId: string, amount: number) => void | Promise<void>;
  onInquiry: (postId: string, message: string) => void | Promise<void>;
  isLoading: boolean;
  hasMoreProducts: boolean;
  isLoadingMore: boolean;
  loadError: string;
  onRetry: () => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
  showOperatorControls: boolean;
  onDeleteProduct: (post: AuctionPost) => void | Promise<void>;
}

/**
 * 새 프로젝트 홈의 PC 카탈로그 구조를 실제 경매 데이터에 연결합니다.
 * 데이터·입찰·문의 핸들러는 기존 FeedList/PostCard가 계속 소유합니다.
 */
export function EditorialCatalogHome({
  posts,
  currentUserName,
  currentUserId,
  onBid,
  onInquiry,
  isLoading,
  hasMoreProducts,
  isLoadingMore,
  loadError,
  onRetry,
  onLoadMore,
  showOperatorControls,
  onDeleteProduct,
}: EditorialCatalogHomeProps) {
  return (
    <main className="mx-auto flex w-full max-w-[1680px] items-start gap-12 px-10 py-7">
      <EditorialCatalogSidebar />
      <FeedList
        posts={posts}
        currentUserName={currentUserName}
        currentUserId={currentUserId}
        onBid={onBid}
        onInquiry={onInquiry}
        isLoading={isLoading}
        hasMoreProducts={hasMoreProducts}
        isLoadingMore={isLoadingMore}
        loadError={loadError}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
        showOperatorControls={showOperatorControls}
        onDeleteProduct={onDeleteProduct}
        title="LIVE DROP"
        description="오늘 공개된 빈티지 의류를 확인하고, 오후 8시 56분 신규 참여 제한 전에 입찰하세요."
      />
    </main>
  );
}
