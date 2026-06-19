import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { decodeFromDeeplink, type DecodeResult } from "../../lib/peerCard";
import { addPeer, type KnownPeer } from "../../api/peerStore";

/**
 * Peer-card camera QR scanner.
 *
 * The PEER-pairing analogue of `GuestPairingScanner` (which targets
 * INSTANCE pairing: `concord+pair://` → HomeserverConfig). This one opens
 * the device's back camera, samples frames into a hidden `<canvas>`, runs
 * `jsQR` per `requestAnimationFrame`, and on a successful decode parses the
 * scanned text as a `concord://peer/<base64url>` deeplink. On a valid card
 * it persists it via `addPeer(card, "qr")`, fires `onPaired(peer)`, and
 * stops the camera.
 *
 * Differences from GuestPairingScanner that matter:
 *   - The peer-card decoder (`decodeFromDeeplink`) NEVER throws — it
 *     returns a discriminated union. So the shared decode seam here returns
 *     that union rather than throwing on a bad payload.
 *   - On `{ok:false}` the error is shown inline and scanning CONTINUES, so
 *     pointing at a non-peer QR (e.g. an instance-pairing QR) just nudges
 *     the user rather than committing junk.
 *   - The success path is async (the store write goes through the Tauri
 *     `peer_store_add` command), so the camera is stopped first, then the
 *     add is awaited, then `onPaired` fires.
 *
 * iOS WKWebView gotchas honoured:
 *   - `<video>` has `playsInline` + `muted` and we call `video.play()`;
 *     without `playsinline` iOS hijacks to fullscreen and the canvas
 *     pipeline never sees a frame.
 *   - `facingMode: "environment"` to prefer the rear camera for scanning.
 *   - Every track is `.stop()`ed and the RAF is cancelled on unmount and
 *     on success so the camera LED turns off immediately.
 */

type ScannerError =
  | { kind: "permission-denied" }
  | { kind: "no-camera" }
  | { kind: "decode-error"; message: string }
  | { kind: "add-error"; message: string }
  | { kind: "generic"; message: string };

export interface PeerQrScannerProps {
  /** Called with the persisted `KnownPeer` after a scanned card is added. */
  onPaired: (peer: KnownPeer) => void;
  /** Called when the user dismisses the scanner without pairing. */
  onClose: () => void;
  /**
   * Optional paste-based fallback: when the user can't aim a camera
   * (desktop, remote pairing), they paste the raw `concord://peer/...`
   * URL here and the scanner still commits the result. Defaults on.
   */
  allowManualPaste?: boolean;
}

/**
 * Shared decode seam — extracted for testability so unit tests can feed a
 * synthetic ImageData through the exact same decode pipeline as the live
 * camera loop (jsdom has no real RAF or camera).
 *
 * Returns the peer-card `DecodeResult` union, or `null` when jsQR finds no
 * QR in the frame at all (so the caller can distinguish "nothing seen yet"
 * from "saw a QR but it wasn't a peer card").
 */
export function scanImageData(imageData: ImageData): DecodeResult | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert",
  });
  if (!result || !result.data) return null;
  return decodeFromDeeplink(result.data);
}

export function PeerQrScanner({
  onPaired,
  onClose,
  allowManualPaste = true,
}: PeerQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Once we hand a valid card off to `addPeer`, stop the scan loop from
  // racing a second decode while the async add is in flight.
  const pairingRef = useRef(false);
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

  /**
   * Commit a decoded peer card: stop the camera first (so the LED goes off
   * immediately), persist via `addPeer(card, "qr")`, then notify the
   * parent. On a store failure we surface it inline but stay open so the
   * user can retry or close manually.
   */
  const commitCard = useCallback(
    async (result: Extract<DecodeResult, { ok: true }>) => {
      if (pairingRef.current) return;
      pairingRef.current = true;
      stop();
      try {
        const peer = await addPeer(result.card, "qr");
        onPaired(peer);
      } catch (err) {
        pairingRef.current = false;
        setError({
          kind: "add-error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [onPaired, stop],
  );

  const tick = useCallback(() => {
    if (pairingRef.current) return;
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = scanImageData(imageData);
    if (decoded) {
      if (decoded.ok) {
        void commitCard(decoded);
        return;
      }
      // A QR was seen but it wasn't a valid peer card. Surface inline and
      // keep scanning so the user can aim at a different code.
      setError({ kind: "decode-error", message: decoded.error });
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [commitCard]);

  const requestCamera = useCallback(async () => {
    setError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
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
          /* autoplay may need a user gesture on some browsers; ignore */
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
    // requestCamera + stop identities are stable via useCallback.
  }, [requestCamera, stop]);

  const handleManualSubmit = useCallback(
    (ev: React.FormEvent) => {
      ev.preventDefault();
      setError(null);
      const result = decodeFromDeeplink(manualPayload.trim());
      if (!result.ok) {
        setError({ kind: "decode-error", message: result.error });
        return;
      }
      void commitCard(result);
    },
    [manualPayload, commitCard],
  );

  return (
    <div
      data-testid="peer-qr-scanner"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a peer's QR code"
    >
      <div className="w-full max-w-md bg-surface-container rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-medium text-on-surface">Scan peer QR</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Point your camera at the peer-card QR shown on another Concord
              install's Peers panel.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stop();
              onClose();
            }}
            data-testid="peer-qr-scanner-close"
            className="p-1 text-on-surface-variant hover:text-on-surface"
            aria-label="Close scanner"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {!error || error.kind === "decode-error" ? (
          <div className="relative aspect-square w-full bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              data-testid="peer-qr-scanner-video"
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        ) : null}

        {error?.kind === "permission-denied" && (
          <div
            data-testid="peer-qr-scanner-permission-denied"
            className="rounded-md border border-error/30 bg-error/10 px-4 py-3 space-y-2"
          >
            <p className="text-sm font-medium text-error">
              Camera permission denied
            </p>
            <p className="text-xs text-on-surface-variant">
              Concord needs permission to use the camera to scan QR codes.
              Re-enable it in your device settings and try again.
            </p>
            <button
              type="button"
              onClick={requestCamera}
              data-testid="peer-qr-scanner-retry"
              className="text-xs text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {error?.kind === "no-camera" && (
          <div
            data-testid="peer-qr-scanner-no-camera"
            className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-warning">
              No camera available
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              This device doesn't report a usable camera. Use the manual paste
              field below to enter the peer link directly.
            </p>
          </div>
        )}

        {error?.kind === "decode-error" && (
          <div
            data-testid="peer-qr-scanner-decode-error"
            className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-warning">
              Couldn't read a peer card
            </p>
            <p className="text-xs text-on-surface-variant mt-1 break-all">
              {error.message}
            </p>
          </div>
        )}

        {error?.kind === "add-error" && (
          <div
            data-testid="peer-qr-scanner-add-error"
            className="rounded-md border border-error/30 bg-error/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-error">Couldn't add peer</p>
            <p className="text-xs text-on-surface-variant mt-1 break-all">
              {error.message}
            </p>
          </div>
        )}

        {error?.kind === "generic" && (
          <div
            data-testid="peer-qr-scanner-generic-error"
            className="rounded-md border border-error/30 bg-error/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-error">Scanner error</p>
            <p className="text-xs text-on-surface-variant mt-1 break-all">
              {error.message}
            </p>
          </div>
        )}

        {allowManualPaste && (
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="text-xs text-on-surface-variant block">
              Or paste the peer link:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualPayload}
                onChange={(e) => setManualPayload(e.target.value)}
                placeholder="concord://peer/…"
                data-testid="peer-qr-scanner-manual-input"
                className="flex-1 px-3 py-2 bg-surface-container-high border border-outline-variant/30 rounded text-xs text-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="submit"
                disabled={manualPayload.trim().length === 0}
                data-testid="peer-qr-scanner-manual-submit"
                className="px-3 py-2 text-xs bg-primary/10 hover:bg-primary/15 text-primary rounded disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
