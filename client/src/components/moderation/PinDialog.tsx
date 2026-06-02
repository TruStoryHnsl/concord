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
      <div className="bg-surface border border-outline-variant/15 rounded-lg shadow-xl w-full max-w-xs mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-on-surface">{title}</h3>
        <p className="text-xs text-on-surface-variant">{description}</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            className="w-full px-4 py-3 bg-surface-container border border-outline-variant/15 rounded-lg text-on-surface text-center text-2xl font-mono tracking-[0.5em] placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
            maxLength={4}
            autoFocus
          />
          {error && <p className="text-error text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 bg-surface-container-highest hover:bg-surface-bright text-on-surface rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || pin.length !== 4}
              className="flex-1 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface rounded-lg text-sm transition-colors"
            >
              {loading ? "..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
