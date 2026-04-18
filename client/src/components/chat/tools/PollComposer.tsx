import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

export function PollComposer({ onSend, onClose }: ComposerProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  const addOption = () => setOptions((o) => [...o, ""]);
  const setOption = (i: number, val: string) =>
    setOptions((o) => o.map((v, idx) => (idx === i ? val : v)));

  const handleSend = async () => {
    if (!question.trim()) return;
    const validOpts = options.filter((o) => o.trim());
    if (validOpts.length < 2) return;
    await onSend(`/poll ${question.trim()} | ${validOpts.join(" | ")}`);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Poll</p>
      <input
        autoFocus
        type="text"
        placeholder="Question..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none"
      />
      <div className="space-y-2">
        {options.map((opt, i) => (
          <input
            key={i}
            type="text"
            placeholder={`Option ${i + 1}`}
            value={opt}
            onChange={(e) => setOption(i, e.target.value)}
            className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none"
          />
        ))}
      </div>
      <button
        type="button"
        onClick={addOption}
        className="text-xs text-primary hover:text-primary/80 transition-colors"
      >
        + Add option
      </button>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
          className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity"
        >
          Send Poll
        </button>
      </div>
    </div>
  );
}
