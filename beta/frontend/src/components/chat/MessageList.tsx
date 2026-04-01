import { useEffect, useRef } from "react";
import type { Message } from "@/api/tauri";
import ChatMessage from "./ChatMessage";

interface MessageListProps {
  messages: Message[];
  ownPeerId: string | null;
}

function MessageList({ messages, ownPeerId }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-y-auto">
        <div className="glass-panel rounded-xl p-6 text-center space-y-2 max-w-sm">
          <span className="material-symbols-outlined text-4xl text-primary/40">
            chat_bubble_outline
          </span>
          <p className="font-headline font-semibold text-sm text-on-surface">
            No messages yet
          </p>
          <p className="text-xs text-on-surface-variant font-body">
            Send the first message to the mesh.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1">
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          isOwn={msg.senderId === ownPeerId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export default MessageList;
