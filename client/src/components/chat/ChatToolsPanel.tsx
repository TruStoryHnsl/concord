import { useRef, useEffect } from "react";
import { PollComposer } from "./tools/PollComposer";
import { HeatmapComposer } from "./tools/HeatmapComposer";
import { TimedComposer } from "./tools/TimedComposer";
import { ScheduledComposer } from "./tools/ScheduledComposer";

export interface ComposerProps {
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
}

export interface ChatTool {
  id: string;
  label: string;
  icon: string; // emoji or material symbol name
  composer: React.ComponentType<ComposerProps> | null; // null = send immediately
}

export const CHAT_TOOLS: ChatTool[] = [
  { id: "poll", label: "Poll", icon: "📊", composer: PollComposer },
  { id: "heatmap", label: "Heatmap", icon: "🔥", composer: HeatmapComposer },
  { id: "gallery", label: "Gallery", icon: "🖼️", composer: null },
  { id: "timed", label: "Timed", icon: "⏱️", composer: TimedComposer },
  { id: "scheduled", label: "Scheduled", icon: "📨", composer: ScheduledComposer },
  { id: "gif", label: "GIF", icon: "🎞️", composer: null },
  { id: "more", label: "More", icon: "➕", composer: null },
];

interface ChatToolsPanelProps {
  onSelectTool: (tool: ChatTool) => void;
  onClose: () => void;
}

export function ChatToolsPanel({ onSelectTool, onClose }: ChatToolsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="glass-panel rounded-2xl p-3 shadow-2xl z-50"
      style={{ width: "256px" }}
    >
      <div className="grid grid-cols-4 gap-2">
        {CHAT_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => {
              onSelectTool(tool);
              if (!tool.composer) onClose();
            }}
            className="btn-press flex flex-col items-center justify-center gap-1 p-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest transition-colors min-h-[48px] min-w-[48px]"
            title={tool.label}
          >
            <span className="text-2xl leading-none">{tool.icon}</span>
            <span className="text-[9px] text-on-surface-variant font-label truncate w-full text-center">
              {tool.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
