import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

export function HeatmapComposer({ onSend, onClose }: ComposerProps) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [granularity, setGranularity] = useState<"day" | "hour">("day");

  const handleSend = async () => {
    if (!title.trim() || !startDate || !endDate) return;
    await onSend(`/heatmap ${title.trim()} | ${startDate} | ${endDate} | ${granularity}`);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Availability Heatmap</p>
      <input
        autoFocus
        type="text"
        placeholder="Event title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none"
      />
      <div className="flex gap-2">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="flex-1 bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="flex-1 bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
        />
      </div>
      <div className="flex rounded-xl overflow-hidden border border-outline-variant/20">
        <button
          type="button"
          onClick={() => setGranularity("day")}
          className={`flex-1 py-1.5 text-xs transition-colors ${granularity === "day" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
        >
          Full day
        </button>
        <button
          type="button"
          onClick={() => setGranularity("hour")}
          className={`flex-1 py-1.5 text-xs transition-colors ${granularity === "hour" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
        >
          Hourly
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!title.trim() || !startDate || !endDate}
          className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity"
        >
          Send
        </button>
      </div>
    </div>
  );
}
