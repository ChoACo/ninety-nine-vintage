"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMemberSupportThreads,
  fetchStaffSupportInbox,
  fetchSupportConversation,
  fetchSupportMessages,
  fetchSupportReadReceipts,
  getOrCreateEmployeeSupportConversation,
  getOrCreateMemberSupportConversation,
  isConversationUnread,
  markSupportConversationRead,
  reopenSupportConversation,
  sendSupportMessage,
  subscribeToMemberSupportChat,
  subscribeToMemberSupportThreads,
  subscribeToStaffSupportInbox,
  updateSupportConversation,
  type SupportConversation,
  type SupportConversationStatus,
  type SupportInboxConversation,
  type SupportMemberConversation,
  type SupportMessage,
} from "@/src/lib/supabase/supportChat";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "상담 연결 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

function upsertMessage(
  messages: readonly SupportMessage[],
  incoming: SupportMessage,
): SupportMessage[] {
  const next = messages.some((message) => message.id === incoming.id)
    ? messages.map((message) => (message.id === incoming.id ? incoming : message))
    : [...messages, incoming];

  return next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function useParticipantSupportChat(
  userId: string | null,
  participantType: "member" | "employee",
) {
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [isSending, setIsSending] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [isUnread, setIsUnread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const messageRequestIdRef = useRef(0);

  const refreshMessages = useCallback(async (conversationId: string) => {
    const requestId = ++messageRequestIdRef.current;
    const nextMessages = await fetchSupportMessages(conversationId);
    if (requestId === messageRequestIdRef.current) {
      setMessages(nextMessages);
    }
  }, []);

  const refreshConversation = useCallback(
    async (conversationId: string) => {
      if (!userId) return;

      const [nextConversation, reads] = await Promise.all([
        fetchSupportConversation(conversationId),
        fetchSupportReadReceipts(userId),
      ]);
      setConversation(nextConversation);
      setIsUnread(
        isConversationUnread(nextConversation, userId, reads.get(conversationId)),
      );
    },
    [userId],
  );

  const reload = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    messageRequestIdRef.current += 1;
    if (!userId) {
      setConversation(null);
      setMessages([]);
      setIsUnread(false);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setConversation(null);
    setMessages([]);
    setIsUnread(false);
    setError(null);
    try {
      const nextConversation =
        participantType === "employee"
          ? await getOrCreateEmployeeSupportConversation()
          : await getOrCreateMemberSupportConversation();
      if (!nextConversation) {
        if (requestId === loadRequestIdRef.current) {
          setConversation(null);
          setMessages([]);
          setIsUnread(false);
        }
        return;
      }
      const [nextMessages, reads] = await Promise.all([
        fetchSupportMessages(nextConversation.id),
        fetchSupportReadReceipts(userId),
      ]);
      if (requestId === loadRequestIdRef.current) {
        setConversation(nextConversation);
        setMessages(nextMessages);
        setIsUnread(
          isConversationUnread(
            nextConversation,
            userId,
            reads.get(nextConversation.id),
          ),
        );
      }
    } catch (loadError) {
      if (requestId === loadRequestIdRef.current) {
        setError(errorMessage(loadError));
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [participantType, userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [reload]);

  const conversationId = conversation?.id ?? null;

  useEffect(() => {
    if (!userId || !conversationId) return;

    return subscribeToMemberSupportChat(conversationId, userId, {
      onSubscribed: () => {
        void refreshMessages(conversationId).catch((realtimeError) =>
          setError(errorMessage(realtimeError)),
        );
        void refreshConversation(conversationId).catch((realtimeError) =>
          setError(errorMessage(realtimeError)),
        );
      },
      onConversationChange: () => {
        void refreshConversation(conversationId).catch((realtimeError) =>
          setError(errorMessage(realtimeError)),
        );
      },
      onMessageChange: (message) => {
        if (message) setMessages((current) => upsertMessage(current, message));
        void refreshConversation(conversationId).catch((realtimeError) =>
          setError(errorMessage(realtimeError)),
        );
      },
      onReadChange: () => {
        void refreshConversation(conversationId).catch((realtimeError) =>
          setError(errorMessage(realtimeError)),
        );
      },
      onError: (realtimeError) => setError(realtimeError.message),
    });
  }, [conversationId, refreshConversation, refreshMessages, userId]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!userId || isSending) return;

      setIsSending(true);
      setError(null);
      try {
        const activeConversation =
          conversation ??
          (participantType === "employee"
            ? await getOrCreateEmployeeSupportConversation()
            : await getOrCreateMemberSupportConversation());
        if (!conversation) setConversation(activeConversation);
        const message = await sendSupportMessage(
          activeConversation.id,
          userId,
          body,
        );
        setMessages((current) => upsertMessage(current, message));
        await refreshConversation(activeConversation.id);
      } catch (sendError) {
        setError(errorMessage(sendError));
        throw sendError;
      } finally {
        setIsSending(false);
      }
    },
    [conversation, isSending, participantType, refreshConversation, userId],
  );

  const markRead = useCallback(async () => {
    const conversationId = conversation?.id;
    if (!userId || !conversationId || !isUnread) return;

    try {
      await markSupportConversationRead(conversationId);
      setIsUnread(false);
    } catch (readError) {
      setError(errorMessage(readError));
    }
  }, [conversation?.id, isUnread, userId]);

  const reopenConversation = useCallback(async () => {
    if (!userId || isReopening) return;

    setIsReopening(true);
    setError(null);
    try {
      const reopened = conversation
        ? await reopenSupportConversation(conversation.id)
        : participantType === "employee"
          ? await getOrCreateEmployeeSupportConversation()
          : await getOrCreateMemberSupportConversation();
      setConversation(reopened);
    } catch (reopenError) {
      setError(errorMessage(reopenError));
      throw reopenError;
    } finally {
      setIsReopening(false);
    }
  }, [conversation, isReopening, participantType, userId]);

  return {
    conversation,
    messages,
    isLoading,
    isSending,
    isReopening,
    isUnread,
    error,
    sendMessage,
    markRead,
    reopenConversation,
    retry: reload,
  };
}

export function useMemberSupportChat(userId: string | null) {
  return useParticipantSupportChat(userId, "member");
}

export function useEmployeeSupportChat(userId: string | null) {
  return useParticipantSupportChat(userId, "employee");
}

export function useMemberSupportThreads(userId: string | null) {
  const [conversations, setConversations] = useState<SupportMemberConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const messagesRequestIdRef = useRef(0);

  const reloadThreads = useCallback(async () => {
    if (!userId) {
      setConversations([]);
      selectedConversationIdRef.current = null;
      setSelectedConversationId(null);
      setMessages([]);
      setIsLoading(false);
      return;
    }

    try {
      await getOrCreateMemberSupportConversation();
      const nextConversations = await fetchMemberSupportThreads(userId);
      setConversations(nextConversations);
      const current = selectedConversationIdRef.current;
      const nextSelectedId =
        current && nextConversations.some((item) => item.id === current)
          ? current
          : nextConversations.find((item) => item.conversationType === "general")?.id ??
            nextConversations[0]?.id ??
            null;
      selectedConversationIdRef.current = nextSelectedId;
      setSelectedConversationId(nextSelectedId);
      if (!nextSelectedId) setMessages([]);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const reloadMessages = useCallback(async (conversationId: string) => {
    const requestId = ++messagesRequestIdRef.current;
    setIsMessagesLoading(true);
    try {
      const nextMessages = await fetchSupportMessages(conversationId);
      if (requestId === messagesRequestIdRef.current) {
        setMessages(nextMessages);
        setError(null);
      }
    } catch (loadError) {
      if (requestId === messagesRequestIdRef.current) {
        setError(errorMessage(loadError));
      }
    } finally {
      if (requestId === messagesRequestIdRef.current) {
        setIsMessagesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsLoading(Boolean(userId));
      void reloadThreads();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [reloadThreads, userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      messagesRequestIdRef.current += 1;
      setMessages([]);
      if (selectedConversationId) {
        void reloadMessages(selectedConversationId);
      } else {
        setIsMessagesLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [reloadMessages, selectedConversationId]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToMemberSupportThreads(userId, {
      onSubscribed: () => {
        void reloadThreads();
        const activeId = selectedConversationIdRef.current;
        if (activeId) void reloadMessages(activeId);
      },
      onConversationChange: () => void reloadThreads(),
      onReadChange: () => void reloadThreads(),
      onMessageChange: (message) => {
        if (message?.conversationId === selectedConversationIdRef.current) {
          setMessages((current) => upsertMessage(current, message));
        }
        void reloadThreads();
      },
      onError: (realtimeError) => setError(realtimeError.message),
    });
  }, [reloadMessages, reloadThreads, userId]);

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

  const selectConversation = useCallback((conversationId: string) => {
    messagesRequestIdRef.current += 1;
    selectedConversationIdRef.current = conversationId;
    setMessages([]);
    setIsMessagesLoading(true);
    setSelectedConversationId(conversationId);
  }, []);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!userId || isSending) return;
      setIsSending(true);
      setError(null);
      try {
        const conversation =
          selectedConversation ?? (await getOrCreateMemberSupportConversation());
        if (!selectedConversation) {
          selectedConversationIdRef.current = conversation.id;
          setSelectedConversationId(conversation.id);
        }
        const message = await sendSupportMessage(conversation.id, userId, body);
        if (selectedConversationIdRef.current === conversation.id) {
          setMessages((current) => upsertMessage(current, message));
        }
        await reloadThreads();
      } catch (sendError) {
        setError(errorMessage(sendError));
        throw sendError;
      } finally {
        setIsSending(false);
      }
    },
    [isSending, reloadThreads, selectedConversation, userId],
  );

  const markRead = useCallback(async () => {
    const conversation = conversations.find(
      (item) => item.id === selectedConversationIdRef.current,
    );
    if (!conversation?.isUnread) return;
    try {
      await markSupportConversationRead(conversation.id);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id ? { ...item, isUnread: false } : item,
        ),
      );
    } catch (readError) {
      setError(errorMessage(readError));
    }
  }, [conversations]);

  const reopenConversation = useCallback(async () => {
    if (!selectedConversation || isReopening) return;
    setIsReopening(true);
    setError(null);
    try {
      await reopenSupportConversation(selectedConversation.id);
      await reloadThreads();
    } catch (reopenError) {
      setError(errorMessage(reopenError));
      throw reopenError;
    } finally {
      setIsReopening(false);
    }
  }, [isReopening, reloadThreads, selectedConversation]);

  return {
    conversations,
    conversation: selectedConversation,
    selectedConversationId,
    selectConversation,
    messages,
    isLoading,
    isMessagesLoading,
    isSending,
    isReopening,
    isUnread: selectedConversation?.isUnread ?? false,
    error,
    sendMessage,
    markRead,
    reopenConversation,
    retry: reloadThreads,
  };
}

export function useStaffSupportInbox(
  staffId: string,
  inboxOperatorId: string | null,
) {
  const [conversations, setConversations] = useState<SupportInboxConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRequestIdRef = useRef(0);
  const selectedConversationIdRef = useRef<string | null>(null);

  const reloadInbox = useCallback(async () => {
    try {
      const nextConversations = inboxOperatorId
        ? await fetchStaffSupportInbox(staffId, inboxOperatorId)
        : [];
      setConversations(nextConversations);
      if (nextConversations.length === 0) setMessages([]);
      const current = selectedConversationIdRef.current;
      const nextSelectedConversationId =
        current && nextConversations.some((item) => item.id === current)
          ? current
          : nextConversations[0]?.id ?? null;
      selectedConversationIdRef.current = nextSelectedConversationId;
      setSelectedConversationId(nextSelectedConversationId);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [inboxOperatorId, staffId]);

  const reloadMessages = useCallback(async (conversationId: string) => {
    const requestId = ++messagesRequestIdRef.current;
    setIsMessagesLoading(true);
    try {
      const nextMessages = await fetchSupportMessages(conversationId);
      if (requestId === messagesRequestIdRef.current) {
        setMessages(nextMessages);
        setError(null);
      }
    } catch (loadError) {
      if (requestId === messagesRequestIdRef.current) {
        setError(errorMessage(loadError));
      }
    } finally {
      if (requestId === messagesRequestIdRef.current) {
        setIsMessagesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      messagesRequestIdRef.current += 1;
      setConversations([]);
      selectedConversationIdRef.current = null;
      setSelectedConversationId(null);
      setMessages([]);
      setIsLoading(true);
      void reloadInbox();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [reloadInbox]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      messagesRequestIdRef.current += 1;
      setMessages([]);
      if (!selectedConversationId) {
        setIsMessagesLoading(false);
        return;
      }
      void reloadMessages(selectedConversationId);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [reloadMessages, selectedConversationId]);

  useEffect(
    () =>
      inboxOperatorId
        ? subscribeToStaffSupportInbox(staffId, inboxOperatorId, {
        onSubscribed: () => {
          void reloadInbox();
          const activeConversationId = selectedConversationIdRef.current;
          if (activeConversationId) void reloadMessages(activeConversationId);
        },
        onConversationChange: () => void reloadInbox(),
        onProfileChange: () => void reloadInbox(),
        onReadChange: () => void reloadInbox(),
        onMessageChange: (message) => {
          if (message?.conversationId === selectedConversationIdRef.current) {
            setMessages((current) => upsertMessage(current, message));
          }
          void reloadInbox();
        },
        onError: (realtimeError) => setError(realtimeError.message),
          })
        : undefined,
    [inboxOperatorId, reloadInbox, reloadMessages, staffId],
  );

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

  const sendMessage = useCallback(
    async (body: string) => {
      if (!selectedConversation || isSending) return;

      setIsSending(true);
      setError(null);
      try {
        const conversationId = selectedConversation.id;
        const message = await sendSupportMessage(
          conversationId,
          staffId,
          body,
        );
        if (selectedConversationIdRef.current === conversationId) {
          setMessages((current) => upsertMessage(current, message));
        }
        await reloadInbox();
      } catch (sendError) {
        setError(errorMessage(sendError));
        throw sendError;
      } finally {
        setIsSending(false);
      }
    },
    [isSending, reloadInbox, selectedConversation, staffId],
  );

  const markRead = useCallback(async () => {
    const conversationId = selectedConversation?.id;
    if (!conversationId || !selectedConversation?.isUnread) return;

    try {
      await markSupportConversationRead(conversationId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, isUnread: false }
            : conversation,
        ),
      );
    } catch (readError) {
      setError(errorMessage(readError));
    }
  }, [selectedConversation?.id, selectedConversation?.isUnread]);

  const changeConversation = useCallback(
    async (updates: {
      status?: SupportConversationStatus;
    }) => {
      if (!selectedConversation || isUpdating) return;

      setIsUpdating(true);
      setError(null);
      try {
        await updateSupportConversation(selectedConversation.id, updates);
        await reloadInbox();
      } catch (updateError) {
        setError(errorMessage(updateError));
        throw updateError;
      } finally {
        setIsUpdating(false);
      }
    },
    [isUpdating, reloadInbox, selectedConversation],
  );

  const selectConversation = useCallback((conversationId: string) => {
    messagesRequestIdRef.current += 1;
    selectedConversationIdRef.current = conversationId;
    setMessages([]);
    setIsMessagesLoading(true);
    setSelectedConversationId(conversationId);
  }, []);

  return {
    conversations,
    selectedConversation,
    selectedConversationId,
    selectConversation,
    messages,
    isLoading,
    isMessagesLoading,
    isSending,
    isUpdating,
    error,
    sendMessage,
    markRead,
    changeConversation,
    retry: reloadInbox,
  };
}
