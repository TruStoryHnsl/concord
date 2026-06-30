/**
 * NativeChatSurface — the native personal-messenger chat surface (Cycle 2 /
 * WS-C). A RESTYLE WRAPPER over the EXISTING Matrix/DM message plumbing: it
 * binds the same `useRoomMessages` / `useSendMessage` / `useSendFile` /
 * typing / read-receipt hooks that the Discord-style ChatLayout uses, then
 * paints them as messenger bubbles per the visual design (§6). There is NO
 * new protocol and NO new message store — only a new presentation.
 *
 * The call/video affordance wires to the EXISTING voice-join path
 * (`joinVoiceSession`) against the DM's matrix room, then reveals the
 * underlying ChatLayout so the existing voice bar / call layer is visible.
 *
 * Adaptive: on phone this is the full-screen detail (a back arrow returns
 * Home); on tablet/desktop it is the detail pane beside the Home list.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent } from "matrix-js-sdk";
import { useAuthStore } from "../../stores/auth";
import { useServerStore } from "../../stores/server";
import { useToastStore } from "../../stores/toast";
import {
  useRoomMessages,
  useSendMessage,
  useSendFile,
  type ChatMessage,
} from "../../hooks/useMatrix";
import { useTypingUsers, useSendTyping } from "../../hooks/useTyping";
import { useSendReadReceipt } from "../../hooks/useUnreadCounts";
import { useDisplayName } from "../../hooks/useDisplayName";
import { joinVoiceSession } from "../voice/joinVoiceSession";
import { BringingUpSplash } from "../BringingUpSplash";
import {
  useHomeFeedStore,
  type ActiveNativeChat,
  type PresenceState,
} from "../../stores/homeFeed";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? words[1]?.[0] : undefined;
  return `${first}${second ?? ""}`.toUpperCase();
}

function presenceLabel(presence?: PresenceState) {
  if (presence === "online") return "Active now";
  if (presence === "away") return "Away";
  return "Offline";
}

function presenceDotClass(presence?: PresenceState) {
  if (presence === "online") return "bg-secondary";
  if (presence === "away") return "bg-primary";
  return "bg-on-surface-variant/50";
}

function dayLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (now - ts < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface HeaderProps {
  chat: ActiveNativeChat;
  displayName: string;
  onBack: () => void;
  onCall: () => void;
  onVideo: () => void;
}

function ChatHeader({ chat, displayName, onBack, onCall, onVideo }: HeaderProps) {
  return (
    <header className="safe-top flex h-14 flex-shrink-0 items-center gap-2 border-b border-outline-variant/10 bg-surface-container-low px-3 md:px-4">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Home"
        title="Back to Home"
        className="btn-press -ml-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface md:hidden"
      >
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>

      <span className="relative inline-flex h-9 w-9 flex-shrink-0">
        <span
          className={cx(
            "flex h-9 w-9 items-center justify-center overflow-hidden rounded-full ring-1 ring-[var(--edge-subtle)]",
            chat.avatarUrl ? "bg-surface-container" : "bg-primary text-on-primary",
          )}
        >
          {chat.avatarUrl ? (
            <img
              src={chat.avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="font-label text-xs font-bold">
              {initials(displayName)}
            </span>
          )}
        </span>
        {chat.presence && (
          <span
            className={cx(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-surface-container-low",
              presenceDotClass(chat.presence),
            )}
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate font-label text-sm font-semibold text-on-surface">
          {displayName}
        </div>
        <div className="truncate font-label text-[11px] text-on-surface-variant">
          {chat.federationLabel
            ? `${presenceLabel(chat.presence)} · ${chat.federationLabel}`
            : presenceLabel(chat.presence)}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onCall}
          aria-label="Voice call"
          title="Voice call"
          className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-xl">call</span>
        </button>
        <button
          type="button"
          onClick={onVideo}
          aria-label="Video call"
          title="Video call"
          className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-xl">videocam</span>
        </button>
        <button
          type="button"
          aria-label="More"
          title="More"
          className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-xl">more_horiz</span>
        </button>
      </div>
    </header>
  );
}

interface BubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  /** Read state shown only under the most recent outgoing message. */
  showReceipt: boolean;
  read: boolean;
}

function MessageBubble({ message, outgoing, showReceipt, read }: BubbleProps) {
  if (message.redacted) {
    return (
      <div
        className={cx(
          "flex w-full",
          outgoing ? "justify-end" : "justify-start",
        )}
      >
        <div className="max-w-[78%] rounded-2xl bg-surface-container px-3 py-2 font-body text-xs italic text-on-surface-variant/70">
          Message deleted
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx("flex w-full", outgoing ? "justify-end" : "justify-start")}
    >
      <div
        className={cx(
          "max-w-[78%] px-3 py-2",
          outgoing
            ? "rounded-2xl rounded-br-md bg-primary text-on-primary"
            : "rounded-2xl rounded-bl-md bg-surface-container-high text-on-surface",
        )}
      >
        <p className="whitespace-pre-wrap break-words font-body text-sm">
          {message.body}
        </p>
        <span
          className={cx(
            "mt-0.5 flex items-center justify-end gap-1",
            outgoing ? "text-on-primary/70" : "text-on-surface-variant/70",
          )}
        >
          {message.edited && (
            <span className="font-label text-[10px]">edited</span>
          )}
          <time className="font-label text-[10px] tabular-nums">
            {timeLabel(message.timestamp)}
          </time>
          {outgoing && showReceipt && (
            <span
              className={cx(
                "material-symbols-outlined text-[14px] leading-none",
                read ? "text-secondary" : "text-on-primary/70",
              )}
              style={{ fontSize: 14 }}
              aria-label={read ? "Read" : "Sent"}
              title={read ? "Read" : "Sent"}
            >
              {read ? "done_all" : "done"}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export function NativeChatSurface({ chat }: { chat: ActiveNativeChat }) {
  const roomId = chat.roomId ?? null;
  const userId = useAuthStore((s) => s.userId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const client = useAuthStore((s) => s.client);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const addToast = useToastStore((s) => s.addToast);
  const goHome = useHomeFeedStore((s) => s.goHome);
  const showHandoff = useHomeFeedStore((s) => s.showHandoff);

  const { messages, isPaginating, hasMore, loadMore } = useRoomMessages(roomId);
  const sendMessage = useSendMessage(roomId);
  const { sendFile, uploading } = useSendFile(roomId);
  const typingUsers = useTypingUsers(roomId);
  const { onKeystroke, onStopTyping } = useSendTyping(roomId);
  useSendReadReceipt(roomId, true);

  // Prefer the live matrix display name over the (possibly stale) row label.
  const resolvedName = useDisplayName(chat.userId ?? "");
  const displayName =
    chat.userId && resolvedName && resolvedName !== chat.userId
      ? resolvedName
      : chat.displayName;

  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [receiptTick, setReceiptTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Live-ticking clock so day dividers/relative labels stay fresh without a
  // remount. Cheap: one timer for the open chat.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to read-receipt updates; bump a tick so the derived read
  // state below recomputes. Effect body only subscribes — no setState.
  useEffect(() => {
    if (!client) return;
    const handler = () => setReceiptTick((t) => t + 1);
    client.on(RoomEvent.Receipt, handler);
    return () => {
      client.removeListener(RoomEvent.Receipt, handler);
    };
  }, [client]);

  // Best-effort: epoch-ms the other party has read up to. Derived (no
  // effect/setState) from the matrix room + receipt tick.
  const readUpToTs = useMemo(() => {
    void receiptTick;
    if (!client || !roomId || !chat.userId) return 0;
    try {
      const room = client.getRoom(roomId);
      if (!room) return 0;
      const evId = room.getEventReadUpTo(chat.userId, false);
      if (!evId) return 0;
      const ev = room
        .getLiveTimeline()
        .getEvents()
        .find((e) => e.getId() === evId);
      return ev?.getTs() ?? 0;
    } catch {
      return 0;
    }
  }, [client, roomId, chat.userId, receiptTick]);

  // Auto-scroll to the newest message when the timeline grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const lastOutgoingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === userId && !messages[i].redacted) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages, userId]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !roomId) return;
    setDraft("");
    onStopTyping();
    try {
      await sendMessage(body);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to send message",
        "error",
      );
      setDraft(body);
    }
  };

  const startCall = async () => {
    if (!roomId || !accessToken) {
      // No room to call into (bare peer). The peers surface owns peer
      // calling today — WS-C seam: native 1:1 peer call needs the
      // peer↔room linkage (Cycle 3 / on-device epic).
      addToast("Open this peer from the Peers panel to start a call.");
      return;
    }
    // Reveal the underlying ChatLayout so the existing voice bar / call
    // layer (z-9000 WebviewCallLayer on native, VoiceConnectionBar on web)
    // is visible while in the call.
    showHandoff();
    try {
      await joinVoiceSession({
        roomId,
        channelName: displayName,
        serverId: chat.sourceId ?? activeServerId ?? "",
        accessToken,
        channelType: "voice",
      });
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to start call",
        "error",
      );
    }
  };

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !roomId) return;
    void sendFile(file).catch((err) =>
      addToast(
        err instanceof Error ? err.message : "Failed to send file",
        "error",
      ),
    );
  };

  const typingLabel = typingUsers.length > 0;
  const canSend = draft.trim().length > 0 && !!roomId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface nav-frame-forward">
      <ChatHeader
        chat={chat}
        displayName={displayName}
        onBack={goHome}
        onCall={startCall}
        onVideo={startCall}
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4"
      >
        {hasMore && messages.length > 0 && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={isPaginating}
              className="btn-press rounded-full bg-surface-container px-3 py-1 font-label text-xs text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
            >
              {isPaginating ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          isPaginating ? (
            <div className="flex h-full items-center justify-center">
              <BringingUpSplash size="compact" status="Loading messages…" />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="font-label text-sm font-semibold text-on-surface">
                No messages yet
              </p>
              <p className="max-w-64 font-body text-xs text-on-surface-variant">
                Say hello to {displayName}.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-1.5">
            {messages.map((message, i) => {
              const prev = messages[i - 1];
              const showDivider =
                !prev ||
                new Date(prev.timestamp).toDateString() !==
                  new Date(message.timestamp).toDateString();
              const outgoing = message.sender === userId;
              const isLastOutgoing = message.id === lastOutgoingId;
              return (
                <div key={message.id} className="space-y-1.5">
                  {showDivider && (
                    <div className="flex justify-center py-1">
                      <span className="text-overline rounded-full bg-surface-container px-2.5 py-0.5 text-[10px] text-on-surface-variant/70">
                        {dayLabel(message.timestamp, now)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    outgoing={outgoing}
                    showReceipt={isLastOutgoing}
                    read={readUpToTs >= message.timestamp}
                  />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {typingLabel && (
          <div className="px-1 pt-1.5 font-label text-[11px] italic text-on-surface-variant/70">
            {displayName} is typing…
          </div>
        )}
      </div>

      <div className="safe-bottom flex-shrink-0 border-t border-outline-variant/10 bg-surface-container-low px-3 py-2">
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleAttach}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !roomId}
            aria-label="Attach file"
            title="Attach file"
            className="btn-press flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-xl">add</span>
          </button>

          <textarea
            value={draft}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value);
              onKeystroke();
            }}
            onBlur={onStopTyping}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={roomId ? "Message" : "No conversation room"}
            disabled={!roomId}
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-2xl bg-surface-container px-3 py-2.5 font-body text-sm text-on-surface outline-none placeholder:text-on-surface-variant/60 disabled:opacity-50"
          />

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-label="Send"
            title="Send"
            className={cx(
              "btn-press flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors",
              canSend
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant/50",
            )}
          >
            <span className="material-symbols-outlined text-xl">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
