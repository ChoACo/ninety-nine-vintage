"use client";

import { useEffect, useState, type FormEvent } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Faq {
  id: string;
  question: string;
  answer: string;
}

interface Conversation {
  id: string;
  member_id: string;
  status: string;
  last_message_preview: string | null;
}

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

interface OnboardingChatPanelProps {
  audience?: "applicant" | "owner";
}

export function OnboardingChatPanel({
  audience = "applicant",
}: Readonly<OnboardingChatPanelProps>) {
  const ownerView = audience === "owner";
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState<string | null>(null);

  const load = async (accessToken: string, conversationId?: string) => {
    const response = await fetch(
      `/api/onboarding-chat${conversationId ? `?conversationId=${conversationId}` : ""}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as {
      faqs?: Faq[];
      conversations?: Conversation[];
      conversation?: Conversation | null;
      messages?: Message[];
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "입점 상담을 불러오지 못했습니다.");
    }
    setFaqs(payload.faqs ?? []);
    setConversations(payload.conversations ?? []);
    setConversation(payload.conversation ?? null);
    setMessages(payload.messages ?? []);
  };

  useEffect(() => {
    void getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => {
        setToken(data.session?.access_token ?? null);
        setUserId(data.session?.user.id ?? null);
        if (data.session) {
          void load(data.session.access_token).catch((error: unknown) =>
            setNotice(
              error instanceof Error
                ? error.message
                : "입점 상담을 불러오지 못했습니다.",
            ),
          );
        }
      });
  }, []);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!token || !body.trim() || busy || (ownerView && !conversation)) return;
    const retryNonce = nonce ?? crypto.randomUUID();
    setNonce(retryNonce);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/onboarding-chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: conversation?.id,
          body: body.trim(),
          clientNonce: retryNonce,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "입점 문의를 보내지 못했습니다.");
      }
      setBody("");
      setNonce(null);
      await load(token, conversation?.id);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "입점 문의를 보내지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!token) return null;

  const content = (
    <>
      <p className="mt-3 text-[11px] text-muted">
        {ownerView
          ? "일반 상품 문의와 분리된 입점 신청자 상담입니다."
          : "일반 상품 문의와 분리된 소유자 상담입니다. 상대 이름은 관리자로만 표시됩니다."}
      </p>
      {faqs.length > 0 ? (
        <div className="mt-4 space-y-2">
          {faqs.map((faq) => (
            <details className="bg-surface p-3" key={faq.id}>
              <summary className="cursor-pointer text-xs font-bold">
                {faq.question}
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      ) : (
        <p className="mt-4 bg-surface p-3 text-[11px] text-muted">
          승인된 FAQ가 아직 없습니다.
          {!ownerView && " 아래에서 관리자에게 직접 문의해 주세요."}
        </p>
      )}
      {conversations.length > 0 && ownerView && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {conversations.map((item) => (
            <button
              className={`border px-3 py-2 text-[10px] ${item.id === conversation?.id ? "border-ink bg-ink text-paper" : "border-line"}`}
              key={item.id}
              onClick={() => token && void load(token, item.id)}
              type="button"
            >
              신청자 {item.member_id.slice(0, 8)} · {item.last_message_preview ?? "입점 상담"}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
        {messages.map((message) => (
          <div
            className={`max-w-[85%] p-3 text-xs ${message.sender_id === userId ? "ml-auto bg-ink text-paper" : "bg-surface"}`}
            key={message.id}
          >
            <p className="mb-1 text-[9px] font-bold opacity-60">
              {message.sender_id === userId
                ? "나"
                : ownerView
                  ? "입점 신청자"
                  : "관리자"}
            </p>
            <p className="whitespace-pre-wrap">{message.body}</p>
          </div>
        ))}
      </div>
      {notice && (
        <div className="mt-3 flex justify-between gap-2 text-xs text-red-700">
          <span>{notice}</span>
          {nonce && (
            <button className="font-bold underline" onClick={() => void send()} type="button">
              같은 내용 재전송
            </button>
          )}
        </div>
      )}
      <form className="mt-4 flex gap-2" onSubmit={send}>
        <input
          className="min-w-0 flex-1 border border-line px-3 text-xs"
          disabled={ownerView && !conversation}
          maxLength={2000}
          onChange={(event) => {
            setBody(event.target.value);
            setNonce(null);
          }}
          placeholder={ownerView ? "선택한 신청자에게 답변" : "입점 문의를 입력하세요"}
          value={body}
        />
        <button
          className="bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40"
          disabled={busy || !body.trim() || (ownerView && !conversation)}
          type="submit"
        >
          {ownerView ? "답변 보내기" : "관리자 연결"}
        </button>
      </form>
    </>
  );

  return ownerView ? (
    <section className="border border-line bg-paper p-5">
      <h1 className="text-xl font-black">입점 전용 상담</h1>
      {content}
    </section>
  ) : (
    <details className="border border-line bg-paper p-4">
      <summary className="cursor-pointer text-xs font-black">
        입점 전용 관리자 상담
      </summary>
      {content}
    </details>
  );
}
