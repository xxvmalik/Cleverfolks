"use client";

import { useState, useRef, useCallback } from "react";
import {
  ACTIVITY_THINKING,
  HIDDEN_ACTIVITIES,
  ERROR_MSG_GENERIC,
  ERROR_MSG_CONNECTION,
  stripMarkdown,
} from "@/lib/skyler/chat-constants";

// ── Types ────────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  taggedLead?: { id: string; name: string } | null;
  /** Activity steps that were performed before this message was generated */
  activities?: string[];
};

export type PipelineContext = {
  source: string;
  pipeline_id?: string;
  contact_name?: string;
  company_name?: string;
  contact_email?: string;
  stage?: string;
  [key: string]: unknown;
};

export type UseSkylerChatOptions = {
  workspaceId: string;
  /** Called after a successful response (e.g., to refresh pipeline data, conversations) */
  onResponseComplete?: (conversationId: string | null) => void;
};

export type UseSkylerChatReturn = {
  messages: ChatMessage[];
  streamingContent: string;
  streamingActivities: string[];
  activitiesDone: boolean;
  isStreaming: boolean;
  activeConversationId: string | null;
  sendMessage: (params: {
    message: string;
    pipelineContext?: PipelineContext | null;
    taggedLead?: { id: string; name: string } | null;
  }) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  clearChat: () => void;
  /** Call when switching conversations — clears streaming state properly */
  switchConversation: (convId: string, messages: ChatMessage[]) => void;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSkylerChat({
  workspaceId,
  onResponseComplete,
}: UseSkylerChatOptions): UseSkylerChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingActivities, setStreamingActivities] = useState<string[]>([]);
  const [activitiesDone, setActivitiesDone] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Ref to track conversationId inside the async SSE handler (avoids stale closure)
  const activeConvIdRef = useRef(activeConversationId);
  activeConvIdRef.current = activeConversationId;

  const resetStreamingState = useCallback(() => {
    setStreamingContent("");
    setStreamingActivities([]);
    setActivitiesDone(false);
  }, []);

  const clearChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    resetStreamingState();
  }, [resetStreamingState]);

  const switchConversation = useCallback(
    (convId: string, loadedMessages: ChatMessage[]) => {
      setActiveConversationId(convId);
      setMessages(loadedMessages);
      resetStreamingState();
    },
    [resetStreamingState]
  );

  const sendMessage = useCallback(
    async ({
      message,
      pipelineContext,
      taggedLead,
    }: {
      message: string;
      pipelineContext?: PipelineContext | null;
      taggedLead?: { id: string; name: string } | null;
    }) => {
      const trimmed = message.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content: trimmed,
        taggedLead: taggedLead ?? null,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent("");
      setStreamingActivities([]);
      setActivitiesDone(false);

      let currentConversationId = activeConvIdRef.current;
      let collectedActivities: string[] = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chatBody: Record<string, any> = {
          message: trimmed,
          workspaceId,
          conversationId: currentConversationId ?? undefined,
        };

        if (pipelineContext) {
          chatBody.pipelineContext = pipelineContext;
        }

        const res = await fetch("/api/skyler/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatBody),
        });

        if (!res.ok || !res.body) {
          throw new Error("Failed to connect to Skyler");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulatedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));

              if (event.type === "activity") {
                setStreamingActivities((prev) => {
                  if (prev[prev.length - 1] === event.action) return prev;
                  const next = [...prev, event.action];
                  collectedActivities = next;
                  return next;
                });
              } else if (event.type === "text") {
                accumulatedText += event.text;
                setStreamingContent(stripMarkdown(accumulatedText));
              } else if (event.type === "metadata") {
                if (event.conversationId) {
                  currentConversationId = event.conversationId;
                  if (!activeConvIdRef.current) {
                    setActiveConversationId(event.conversationId);
                  }
                }
              } else if (event.type === "done") {
                // Filter out hidden activities before attaching to message
                const visibleActivities = collectedActivities.filter(
                  (a) => !HIDDEN_ACTIVITIES.has(a)
                );
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: "assistant",
                    content: stripMarkdown(accumulatedText),
                    activities: visibleActivities.length > 0 ? visibleActivities : undefined,
                  },
                ]);
                setStreamingContent("");
                setActivitiesDone(true);
                onResponseComplete?.(currentConversationId);
              } else if (event.type === "error") {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `error-${Date.now()}`,
                    role: "assistant",
                    content: ERROR_MSG_GENERIC,
                  },
                ]);
                setStreamingContent("");
                setStreamingActivities([]);
                setActivitiesDone(false);
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: ERROR_MSG_CONNECTION,
          },
        ]);
        setStreamingContent("");
        setStreamingActivities([]);
        setActivitiesDone(false);
      } finally {
        setIsStreaming(false);
      }
    },
    [workspaceId, isStreaming, onResponseComplete]
  );

  return {
    messages,
    streamingContent,
    streamingActivities,
    activitiesDone,
    isStreaming,
    activeConversationId,
    sendMessage,
    setMessages,
    setActiveConversationId,
    clearChat,
    switchConversation,
  };
}
