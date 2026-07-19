"use client";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { AuctionPost } from "@/src/types/auction";

export type FeedProductControlAction = "pause" | "delete";

interface FeedProductControlModalProps {
  action: FeedProductControlAction;
  post: AuctionPost;
  isSubmitting: boolean;
  error?: string;
  onClose: () => void;
  onConfirmDelete: () => void | Promise<void>;
}

export default function FeedProductControlModal({
  action,
  post,
  isSubmitting,
  error = "",
  onClose,
  onConfirmDelete,
}: FeedProductControlModalProps) {
  const lot = `LOT ${post.id.slice(0, 8).toUpperCase()}`;
  const pauseLocked = action === "pause";

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={!isSubmitting}
      size="sm"
      tone="dark"
      headerVariant="editorial"
      headerPrefix={lot}
      closeShortcutLabel="ESC"
      title={
        pauseLocked
          ? "경매 일시정지 확인"
          : "경매 즉시 삭제 확인"
      }
      description={post.title}
      className="border-red-500/25"
    >
      <div className="space-y-3 px-5 py-5 sm:px-6">
          {pauseLocked ? (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm font-bold leading-6 text-amber-100">
              진행 중 경매의 미공개 전환은 입찰 원장 보호 정책으로 서버에서 잠겨
              있습니다. 가짜 화면 상태는 만들지 않으며, 감사 로그가 남는 전용
              일시정지 RPC가 도입된 뒤 활성화됩니다.
            </div>
          ) : (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-100">
              삭제 후 피드에서 즉시 제거됩니다. 입찰 기록이 있거나 서버 보호 정책에
              걸린 상품은 삭제되지 않으며 원본 데이터가 그대로 유지됩니다.
            </div>
          )}

          {error ? (
            <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
              {error}
            </p>
          ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 bg-black/35 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-4">
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>
            {pauseLocked ? "확인" : "취소"}
          </Button>
          {!pauseLocked ? (
            <Button
              isLoading={isSubmitting}
              onClick={() => void onConfirmDelete()}
              className="border-red-500 bg-red-600 text-white hover:bg-red-500"
            >
              {isSubmitting ? "삭제 중…" : "즉시 삭제 확정"}
            </Button>
          ) : null}
      </div>
    </Modal>
  );
}
