import type { Message } from "@/api/tauri";
import { formatRelativeTime, shortenPeerId } from "@/utils/format";

interface ChatMessageProps {
  message: Message;
  isOwn: boolean;
}

function ChatMessage({ message, isOwn }: ChatMessageProps) {
  return (
    <div
      className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-2`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isOwn
            ? "primary-glow text-on-primary rounded-br-md"
            : "bg-surface-container-high text-on-surface rounded-bl-md"
        }`}
      >
        {!isOwn && (
          <p className="text-[11px] font-label font-semibold text-primary mb-0.5">
            {shortenPeerId(message.senderId)}
          </p>
        )}
        <p className="font-body text-sm leading-relaxed break-words">
          {message.content}
        </p>
        <p
          className={`text-[10px] mt-1 ${
            isOwn ? "text-on-primary/60" : "text-on-surface-variant"
          }`}
        >
          {formatRelativeTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

export default ChatMessage;
