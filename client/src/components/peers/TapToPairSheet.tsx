/**
 * Tap-to-pair sheet. Mobile-only pairing UI. Reuses <BringingUpSplash />
 * for the searching/connecting states — it is the ONLY loading animation in
 * Concord; do not add a spinner here.
 */
import { useProximityPairStore } from "../../stores/proximityPair";
import { BringingUpSplash } from "../BringingUpSplash";

interface TapToPairSheetProps {
  open: boolean;
  onClose: () => void;
}

export function TapToPairSheet({ open, onClose }: TapToPairSheetProps) {
  const phase = useProximityPairStore((s) => s.phase);
  const code = useProximityPairStore((s) => s.code);
  const error = useProximityPairStore((s) => s.error);
  const confirm = useProximityPairStore((s) => s.confirm);
  const cancel = useProximityPairStore((s) => s.cancel);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Tap to pair"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="w-[min(92vw,28rem)] rounded-2xl bg-surface p-6 text-center space-y-4">
        {(phase === "searching" || phase === "connecting") && (
          <>
            <BringingUpSplash size="compact" status="Bring the two phones together…" />
          </>
        )}

        {phase === "awaitingConfirm" && (
          <>
            <p className="text-sm text-on-surface-variant">
              Confirm the same code shows on both phones:
            </p>
            <p className="text-4xl font-mono tracking-[0.3em] text-on-surface">
              {code}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <button
                className="px-4 py-2 rounded-lg bg-primary text-on-primary"
                onClick={() => void confirm()}
              >
                Confirm
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-surface-variant text-on-surface"
                onClick={() => void cancel().then(onClose)}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === "paired" && (
          <>
            <p className="text-lg text-on-surface">Paired ✓</p>
            <button
              className="px-4 py-2 rounded-lg bg-primary text-on-primary"
              onClick={onClose}
            >
              Done
            </button>
          </>
        )}

        {phase === "error" && (
          <>
            <p className="text-sm text-error">{error ?? "Pairing failed."}</p>
            <button
              className="px-4 py-2 rounded-lg bg-surface-variant text-on-surface"
              onClick={() => void cancel().then(onClose)}
            >
              Close
            </button>
          </>
        )}

        {phase === "unsupported" && (
          <>
            <p className="text-sm text-on-surface-variant">
              Tap to pair needs a phone with Bluetooth — not available on this device.
            </p>
            <button className="px-4 py-2 rounded-lg bg-surface-variant" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
