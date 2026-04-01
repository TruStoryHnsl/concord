import { useState, useCallback, useRef, type KeyboardEvent, type ClipboardEvent } from "react";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";

const PIN_LENGTH = 6;

function GuestAuthPage() {
  const [pin, setPin] = useState<string[]>(Array.from({ length: PIN_LENGTH }, () => ""));
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handlePinChange = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      const digit = value.replace(/\D/g, "").slice(-1);
      setPin((prev) => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });
      // Auto-advance to next input
      if (digit && index < PIN_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [],
  );

  const handlePinKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !pin[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [pin],
  );

  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (pasted.length > 0) {
      setPin(
        Array.from({ length: PIN_LENGTH }, (_, i) => pasted[i] ?? ""),
      );
      // Focus the input after the last pasted digit
      const focusIndex = Math.min(pasted.length, PIN_LENGTH - 1);
      inputRefs.current[focusIndex]?.focus();
    }
  }, []);

  const fullPin = pin.join("");
  const canJoin = fullPin.length === PIN_LENGTH && displayName.trim().length > 0;

  const handleJoin = useCallback(async () => {
    if (!canJoin) return;
    setJoining(true);
    setError(null);
    try {
      // Guest join will be handled by the webhost WebSocket API
      // For now, this is a placeholder that demonstrates the UI flow
      console.log("[guest] Joining session with PIN:", fullPin, "as", displayName.trim());
      // In production: connect via WebSocket to the host's webhost server
      // await connectToWebhost(fullPin, displayName.trim());
    } catch (err) {
      console.error("Failed to join session:", err);
      setError(err instanceof Error ? err.message : "Failed to join session");
    } finally {
      setJoining(false);
    }
  }, [canJoin, fullPin, displayName]);

  return (
    <div className="mesh-background min-h-screen flex items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-sm">
        {/* Branding */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-3xl">
              hub
            </span>
            <span className="font-headline font-bold text-2xl tracking-wide bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              CONCORD
            </span>
          </div>
          <p className="text-sm text-on-surface-variant font-body">
            Join as a guest
          </p>
        </div>

        <GlassPanel className="p-6 space-y-6">
          {/* PIN Input */}
          <div className="space-y-3">
            <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant block text-center">
              Enter Session PIN
            </label>
            <div className="flex items-center justify-center gap-2">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={pin[i] ?? ""}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  className="w-11 h-14 text-center rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface font-headline text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                  autoComplete="off"
                />
              ))}
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Guest"
              maxLength={32}
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container border-none text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canJoin) {
                  void handleJoin();
                }
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-error-container/20 border border-error/20">
              <span className="material-symbols-outlined text-error text-base">
                error
              </span>
              <p className="text-xs text-on-error-container font-body">
                {error}
              </p>
            </div>
          )}

          {/* Join Button */}
          <Button
            variant="primary"
            className="w-full py-3"
            onClick={() => void handleJoin()}
            disabled={!canJoin || joining}
          >
            {joining ? (
              <>
                <span className="material-symbols-outlined text-lg animate-spin">
                  progress_activity
                </span>
                Connecting...
              </>
            ) : (
              <>
                Join Session
                <span className="material-symbols-outlined text-lg">
                  login
                </span>
              </>
            )}
          </Button>
        </GlassPanel>

        {/* Footer */}
        <p className="text-center text-[10px] text-on-surface-variant/50 font-body mt-4">
          Powered by the Concord mesh network
        </p>
      </div>
    </div>
  );
}

export default GuestAuthPage;
