/**
 * Task 5004: Chat page — /agents
 *
 * Client component. Two-pane layout:
 *   - left:  ConversationList (file cabinet)
 *   - right: ChatContainer   (wire desk)
 *
 * Responsibilities:
 *   - load GET /api/agent/history on mount and on new-conversation events
 *   - group history into ConversationSummary[]
 *   - track activeConversationId and pass it to ChatContainer
 *   - on mobile, toggle between the two panels with a local state flag
 *
 * Spec alignment:
 *   - spec.md AC-16: operate the LLM from the chat screen
 *   - spec.md AC-17: preview + approval before executing any action
 *
 * Falls back to a demo archive when the API is unreachable so the page
 * still renders coherently during local design review.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { ConversationList } from "@/components/chat/ConversationList";
import {
  fetchHistory,
  groupHistoryByConversation,
  type ConversationSummary,
} from "@/components/chat/api";

type MobilePane = "cabinet" | "desk";

export default function AgentsPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("desk");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const res = await fetchHistory({ limit: 200 });
    if (res.ok) {
      const grouped = groupHistoryByConversation(res.value);
      setConversations(grouped);
      setOffline(Boolean(res.isFallback));
    } else {
      setConversations([]);
      setOffline(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setMobilePane("desk");
  }, []);

  const handleNew = useCallback(() => {
    setActiveId(null);
    setMobilePane("desk");
  }, []);

  const handleConversationChanged = useCallback(
    (cid: string) => {
      setActiveId((prev) => prev ?? cid);
      // Refresh archive opportunistically (non-blocking).
      void loadHistory();
    },
    [loadHistory],
  );

  const editionNumber =
    conversations.findIndex((c) => c.id === activeId) >= 0
      ? conversations.findIndex((c) => c.id === activeId) + 1
      : conversations.length + 1;

  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden border-y border-base-content/15 bg-base-100 lg:-m-6 lg:h-[calc(100vh-4rem)]">
      {/* Cabinet (left) — responsive: always visible at lg+, toggleable below */}
      <div
        className={`w-full shrink-0 lg:block lg:w-[320px] ${
          mobilePane === "cabinet" ? "block" : "hidden"
        }`}
      >
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          loading={loading}
          offline={offline}
          onSelect={handleSelect}
          onNew={handleNew}
          onAfterSelect={() => setMobilePane("desk")}
        />
      </div>

      {/* Desk (right) */}
      <div
        className={`min-w-0 flex-1 lg:block ${mobilePane === "desk" ? "block" : "hidden lg:block"}`}
      >
        <ChatContainer
          key={activeId ?? "new"}
          conversationId={activeId}
          onConversationChanged={handleConversationChanged}
          onOpenCabinet={() => setMobilePane("cabinet")}
          editionNumber={editionNumber}
        />
      </div>
    </div>
  );
}
