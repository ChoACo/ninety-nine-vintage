"use client";

import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import Modal from "@/src/components/common/Modal";
import type {
  AdminCustomerChatPayload,
  AdminCustomerChatThread,
  BuyerInfo,
} from "@/src/types/auction";

interface AdminCsChatModalProps {
  buyer: BuyerInfo | null;
  thread?: AdminCustomerChatThread;
  onSendMessage: (payload: AdminCustomerChatPayload) => void | Promise<void>;
  onClose: () => void;
}

const QUICK_MESSAGES = [
  "입금이 지연되고 있습니다. 입금 마감 시간을 확인해 주세요.",
  "문의하신 상품 사이즈와 상태를 확인해 답변드립니다.",
] as const;

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function AdminCsChatModal({
  buyer,
  thread,
  onSendMessage,
  onClose,
}: AdminCsChatModalProps) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, buyer?.userId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!buyer || !text || isSending) return;

    setIsSending(true);
    setErrorMessage("");
    try {
      // TODO: DB 연동 필요 - 관리자/고객 1:1 채팅 API와 실시간 구독으로 교체합니다.
      await onSendMessage({
        userId: buyer.userId,
        customerName: buyer.name,
        text,
      });
      setDraft("");
    } catch {
      setErrorMessage("메시지를 보내지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    if (isSending) return;
    setDraft("");
    setErrorMessage("");
    onClose();
  };

  return (
    <Modal
      open={Boolean(buyer)}
      title={`💬 ${buyer?.name ?? "고객"}님 1:1 직통 톡`}
      size="md"
      className="h-[min(86dvh,46rem)]"
      closeOnBackdrop={!isSending}
      onClose={isSending ? () => undefined : handleClose}
    >
      {buyer ? (
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-[#eadfd4] bg-[#fff5e9] px-5 py-4 text-[17px]">
            <div>
              <p className="text-xl font-black text-[#493d35]">{buyer.name}</p>
              <p className="font-bold text-[#76685f]">낙찰 고객 CS 채팅</p>
            </div>
            <span className="rounded-full bg-[#eeeae5] px-3 py-1.5 font-black text-[#706a63]">
              고객 대화
            </span>
          </header>

          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f9f5ef] p-5"
            aria-live="polite"
            aria-label={`${buyer.name} 고객 대화 내용`}
          >
            {thread && thread.messages.length > 0 ? (
              thread.messages.map((message) => {
                const isAdmin = message.sender === "admin";
                return (
                  <article
                    key={message.id}
                    className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-[1.35rem] px-4 py-3 text-[17px] font-bold leading-7 shadow-sm ${
                        isAdmin
                          ? "rounded-br-md bg-[#dc7865] text-white"
                          : "rounded-bl-md border border-[#ddd2c6] bg-white text-[#4f443d]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.text}</p>
                      <time
                        dateTime={message.sentAt}
                        className={`mt-1 block text-right text-[17px] font-semibold ${
                          isAdmin ? "text-white/80" : "text-[#8b7d72]"
                        }`}
                      >
                        {formatMessageTime(message.sentAt)}
                      </time>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="rounded-2xl border-2 border-dashed border-[#d9ccbf] bg-white/75 px-5 py-10 text-center text-[17px] font-bold leading-7 text-[#766a61]">
                아직 대화가 없습니다.
                <br />아래에서 고객에게 첫 메시지를 보내세요.
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[#e8ddd2] bg-white p-4 sm:p-5">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {QUICK_MESSAGES.map((message) => (
                <button
                  key={message}
                  type="button"
                  onClick={() => setDraft(message)}
                  className="min-h-11 shrink-0 rounded-full border-2 border-[#c8d9dd] bg-[#eef6f7] px-4 py-2 text-[17px] font-black text-[#526f78] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d1e5e8]"
                >
                  {message.startsWith("입금") ? "입금 지연 안내" : "상품 문의 답변"}
                </button>
              ))}
            </div>
            <form onSubmit={handleSubmit} className="flex items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">고객에게 보낼 메시지</span>
                <textarea
                  value={draft}
                  disabled={isSending}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                  placeholder="고객에게 보낼 안내를 입력하세요"
                  className="min-h-16 w-full resize-none rounded-2xl border-2 border-[#d9cabc] bg-[#fffdf9] px-4 py-3 text-[17px] font-bold leading-7 text-[#493e36] outline-none placeholder:text-[#a09286] focus:border-[#db806d] focus:ring-4 focus:ring-[#f2c7bd]/60"
                />
              </label>
              <button
                type="submit"
                disabled={!draft.trim() || isSending}
                className="min-h-16 shrink-0 rounded-2xl bg-[#df7865] px-5 py-3 text-[17px] font-black text-white transition hover:bg-[#ca6552] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#efb7ab] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? "전송 중" : "보내기"}
              </button>
            </form>
            {errorMessage ? (
              <p role="alert" className="mt-2 text-[17px] font-black text-[#ad4f40]">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
