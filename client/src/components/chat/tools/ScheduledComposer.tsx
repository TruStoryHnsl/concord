import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

export function ScheduledComposer({ onSend, onClose }: ComposerProps) {
  const [messageText, setMessageText] = useState("");
  const [deliverAt, setDeliverAt] = useState("");

  const handleSend = async () => {
    if (!messageText.trim() || !deliverAt) return;
    await onSend(`/scheduled ${deliverAt} | ${messageText.trim()}`);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Scheduled Message</p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Message to send later..."
        value={messageText}
        onChange={(e) => setMessageText(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none resize-none"
      />
      <input
        type="datetime-local"
        value={deliverAt}
        onChange={(e) => setDeliverAt(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
      />
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!messageText.trim() || !deliverAt}
          className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity"
        >
          Schedule
        </button>
      </div>
    </div>
  );
}
