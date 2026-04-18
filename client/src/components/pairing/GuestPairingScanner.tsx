import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import type { HomeserverConfig } from "../../api/wellKnown";
import { decodePairingPayload, PairingDecodeError } from "./pairingSchema";

/**
 * INS-022: Guest-side pairing scanner.
 *
 * Opens the device's back camera, samples frames into a hidden
 * `<canvas>`, and runs `jsQR` on each frame. On successful decode,
 * the payload is validated via `decodePairingPayload` and the caller's
 * `onSuccess(HomeserverConfig)` handler is invoked — which in
 * `ServerPickerScreen` wires into `setHomeserver` + `onConnected`.
 *
 * Error cases handled explicitly:
 *   - `NotAllowedError` / permission denied → renders a targeted
 *     message with a retry button.
 *   - `NotFoundError` / no camera → renders a "no camera available"
 *     message with a manual-paste fallback.
 *   - `PairingDecodeError` thrown mid-scan → shown inline, scanning
 *     continues so a second attempt can succeed.
 *
 * Lifecycle:
 *   - Camera track is started on mount via `requestCamera()`.
 *   - Track is stopped on unmount and on `onSuccess` dispatch so the
 *     camera LED turns off immediately.
 *   - Scan loop runs via `requestAnimationFrame`. In jsdom tests the
 *     animation frame never fires; tests drive the decoder via the
 *     exposed `scanImageData` helper instead.
 */

type ScannerError =
  | { kind: "permission-denied" }
  | { kind: "no-camera" }
  | { kind: "decode-error"; message: string }
  | { kind: "generic"; message: string };

export interface GuestPairingScannerProps {
  /**
   * Called with the decoded `HomeserverConfig` once a frame yields a
   * valid pairing payload. The caller owns the routing (store write,
   * navigation).
   */
  onSuccess: (config: HomeserverConfig) => void;
  /** Called when the user dismisses the scanner without success. */
  onClose: () => void;
  /**
   * Optional paste-based fallback: when the user can't aim a camera
   * (remote pairing, desktop), they paste the raw `concord+pair://...`
   * URL here and the scanner still commits the result.
   */
  allowManualPaste?: boolean;
}

/**
 * Shared helper — extracted for testability so unit tests can feed a
 * synthetic ImageData through the same decode pipeline as the live
 * camera loop.
 */
export function scanImageData(
  imageData: ImageData,
): HomeserverConfig | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert",
  });
  if (!result || !result.data) return null;
  return decodePairingPayload(result.data);
}

export function GuestPairingScanner({
  onSuccess,
  onClose,
  allowManualPaste = true,
}: GuestPairingScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);
  const [manualPayload, setManualPayload] = useState("");

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleDecodedConfig = useCallback(
    (config: HomeserverConfig) => {
      stop();
      onSuccess(config);
    },
    [onSuccess, stop],
  );

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    try {
      const decoded = scanImageData(imageData);
      if (decoded) {
        handleDecodedConfig(decoded);
        return;
      }
    } catch (err) {
      if (err instanceof PairingDecodeError) {
        // A QR was seen but the payload was garbage. Surface inline
        // and keep scanning so the user can try a different code.
        setError({ kind: "decode-error", message: err.message });
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [handleDecodedConfig]);

  const requestCamera = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError({ kind: "no-camera" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {
          /* autoplay may require user gesture on some browsers; ignore */
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError({ kind: "permission-denied" });
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError({ kind: "no-camera" });
      } else {
        setError({
          kind: "generic",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [tick]);

  useEffect(() => {
    requestCamera();
    return stop;
    // requestCamera + stop identity is stable via useCallback; tick loop
    // starts only when a stream arrives.
  }, [requestCamera, stop]);

  const handleManualSubmit = useCallback(
    (ev: React.FormEvent) => {
      ev.preventDefault();
      setError(null);
      try {
        const config = decodePairingPayload(manualPayload.trim());
        handleDecodedConfig(config);
      } catch (err) {
        if (err instanceof PairingDecodeError) {
          setError({ kind: "decode-error", message: err.message });
        } else {
          setError({
            kind: "generic",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [manualPayload, handleDecodedConfig],
  );

  return (
    <div
      data-testid="guest-pairing-scanner"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pair from another device"
    >
      <div className="w-full max-w-md bg-surface-container rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-medium text-on-surface">Scan pairing QR</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Point your camera at the QR code shown on the hosting phone's
              Settings → Node panel.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stop();
              onClose();
            }}
            data-testid="guest-pairing-scanner-close"
            className="p-1 text-on-surface-variant hover:text-on-surface"
            aria-label="Close scanner"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {!error && (
          <div className="relative aspect-square w-full bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              data-testid="guest-pairing-scanner-video"
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {error?.kind === "permission-denied" && (
          <div
            data-testid="guest-pairing-scanner-permission-denied"
            className="rounded-md border border-error/30 bg-error/10 px-4 py-3 space-y-2"
          >
            <p className="text-sm font-medium text-error">Camera permission denied</p>
            <p className="text-xs text-on-surface-variant">
              Concord needs permission to use the camera to scan QR codes.
              Re-enable it in your device settings and try again.
            </p>
            <button
              type="button"
              onClick={requestCamera}
              data-testid="guest-pairing-scanner-retry"
              className="text-xs text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {error?.kind === "no-camera" && (
          <div
            data-testid="guest-pairing-scanner-no-camera"
            className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-warning">No camera available</p>
            <p className="text-xs text-on-surface-variant mt-1">
              This device doesn't report a usable camera. Use the manual
              paste field below to enter the pairing URL directly.
            </p>
          </div>
        )}

        {error?.kind === "decode-error" && (
          <div
            data-testid="guest-pairing-scanner-decode-error"
            className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-warning">Couldn't read code</p>
            <p className="text-xs text-on-surface-variant mt-1 break-all">{error.message}</p>
          </div>
        )}

        {error?.kind === "generic" && (
          <div
            data-testid="guest-pairing-scanner-generic-error"
            className="rounded-md border border-error/30 bg-error/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-error">Scanner error</p>
            <p className="text-xs text-on-surface-variant mt-1 break-all">{error.message}</p>
          </div>
        )}

        {allowManualPaste && (
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="text-xs text-on-surface-variant block">
              Or paste the pairing URL:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualPayload}
                onChange={(e) => setManualPayload(e.target.value)}
                placeholder="concord+pair://v1/?d=..."
                data-testid="guest-pairing-scanner-manual-input"
                className="flex-1 px-3 py-2 bg-surface-container-high border border-outline-variant/30 rounded text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="submit"
                disabled={manualPayload.trim().length === 0}
                data-testid="guest-pairing-scanner-manual-submit"
                className="px-3 py-2 text-xs bg-primary/10 hover:bg-primary/15 text-primary rounded disabled:opacity-40"
              >
                Use
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
