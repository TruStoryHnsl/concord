import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

const DURATION_PRESETS = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "1 hr", value: 3600 },
  { label: "1 day", value: 86400 },
];

export function TimedComposer({ onSend, onClose }: ComposerProps) {
  const [messageText, setMessageText] = useState("");
  const [seconds, setSeconds] = useState(300);

  const handleSend = async () => {
    if (!messageText.trim()) return;
    await onSend(`/timed ${seconds} | ${messageText.trim()}`);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Timed Message</p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Message that will auto-delete..."
        value={messageText}
        onChange={(e) => setMessageText(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none resize-none"
      />
      <div className="flex gap-1.5">
        {DURATION_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setSeconds(p.value)}
            className={`flex-1 py-1.5 rounded-lg text-xs transition-colors ${seconds === p.value ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!messageText.trim()}
          className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity"
        >
          Send
        </button>
      </div>
    </div>
  );
}
