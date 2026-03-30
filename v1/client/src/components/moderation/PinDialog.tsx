import { useState } from "react";

interface PinDialogProps {
  title: string;
  description: string;
  onSubmit: (pin: string) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export function PinDialog({ title, description, onSubmit, onCancel, submitLabel = "Submit" }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) return;
    setError("");
    setLoading(true);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-xs mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="text-xs text-zinc-400">{description}</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-center text-2xl font-mono tracking-[0.5em] placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            maxLength={4}
            autoFocus
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || pin.length !== 4}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm transition-colors"
            >
              {loading ? "..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
