"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { ChatHeader, type ChatTab } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { ChatEmpty } from "./chat-empty";
import { ChatHistory } from "./chat-history";
import type { ChatMessage, ConversationItem, TaggedLead } from "../types";

export function ChatPanel({
  open,
  onToggle,
  messages,
  conversations,
  streamingContent,
  inputValue,
  onInputChange,
  onSend,
  taggedLead,
  onClearTag,
  isStreaming,
  onSelectConversation,
}: {
  open: boolean;
  onToggle: () => void;
  messages: ChatMessage[];
  conversations: ConversationItem[];
  streamingContent: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  taggedLead: TaggedLead | null;
  onClearTag: () => void;
  isStreaming: boolean;
  onSelectConversation: (id: string) => void;
}) {
  const [chatTab, setChatTab] = useState<ChatTab>("chat");

  // FAB when closed
  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed z-50"
        style={{
          bottom: 24,
          right: 24,
          width: 48,
          height: 48,
          borderRadius: 14,
          background: "linear-gradient(135deg, var(--sk-orange), #E8752B)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 20px rgba(242,144,61,0.3)",
          animation: "sk-fadeSlideUp 0.3s var(--sk-ease-out)",
        }}
      >
        <MessageSquare size={20} color="#fff" />
      </button>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{
        width: 310,
        minWidth: 310,
        background: "var(--sk-surface)",
        borderLeft: "1px solid var(--sk-border)",
        animation: "sk-contentIn 0.3s var(--sk-ease-out)",
      }}
    >
      <ChatHeader activeTab={chatTab} onTabChange={setChatTab} onClose={onToggle} />

      {chatTab === "chat" ? (
        <>
          {messages.length === 0 && !streamingContent ? (
            <ChatEmpty />
          ) : (
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              taggedLeadName={taggedLead?.name}
            />
          )}
          <ChatInput
            value={inputValue}
            onChange={onInputChange}
            onSend={onSend}
            taggedLead={taggedLead}
            onClearTag={onClearTag}
            disabled={isStreaming}
          />
        </>
      ) : (
        <ChatHistory
          conversations={conversations}
          onSelectConversation={onSelectConversation}
        />
      )}
    </div>
  );
}
