import { useDisplayNames } from "../../hooks/useDisplayName";

interface TypingIndicatorProps {
  typingUsers: string[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  const displayNames = useDisplayNames(typingUsers);

  if (typingUsers.length === 0) return null;

  const names = typingUsers.map((u) => displayNames[u] || u);
  let text: string;
  if (names.length === 1) {
    text = `${names[0]} is typing`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing`;
  } else {
    text = "Several people are typing";
  }

  return (
    <div className="h-6 px-4 flex items-center gap-1.5 text-xs text-on-surface-variant font-label">
      <span className="flex gap-0.5">
        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
      </span>
      <span>{text}</span>
    </div>
  );
}
