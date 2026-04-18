import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useServerConfigStore } from "../../stores/serverConfig";
import { encodePairingPayload } from "./pairingSchema";

/**
 * INS-022: Host-side pairing QR.
 *
 * Renders a QR code containing a wellKnown-compatible snapshot of the
 * current server config. A second phone can scan this code with
 * `GuestPairingScanner` to join the same upstream without typing a
 * hostname.
 *
 * Hiding rules:
 *   - When no server config is selected (fresh install, no homeserver
 *     known yet), the QR is replaced with an informational note
 *     explaining that the user must pick a server first.
 *   - When the QR payload is present, a "copy URL" fallback is always
 *     rendered below the image — useful when the guest phone's camera
 *     can't see the screen, or for remote pairing over chat.
 *
 * Privacy: the encoded payload intentionally strips ephemeral and
 * security-sensitive fields (TURN credentials, feature flags). See
 * `pairingSchema.ts`. Operators sharing a QR on a public stream do not
 * leak their TURN credentials.
 */
export function HostPairingQR() {
  const config = useServerConfigStore((s) => s.config);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!config) {
      setDataUrl(null);
      setPairingUrl(null);
      return;
    }
    const url = encodePairingPayload({
      host: config.host,
      homeserver_url: config.homeserver_url,
      api_base: config.api_base,
      server_name: config.server_name,
      livekit_url: config.livekit_url,
      instance_name: config.instance_name,
    });
    setPairingUrl(url);

    let cancelled = false;
    // Medium error correction is a reasonable default for phone-to-phone
    // scans — the room is usually well-lit enough that high correction
    // is overkill, and L correction makes the code visibly sparser.
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
      color: {
        // Concord surface palette — dark QR on light background so it
        // still scans cleanly in a dark-themed app.
        dark: "#0c0e11",
        light: "#f5f5f7",
      },
    })
      .then((dataUri) => {
        if (!cancelled) setDataUrl(dataUri);
      })
      .catch((err) => {
        // Log but don't crash — the copy-URL fallback still works.
        console.error("[HostPairingQR] QR generation failed:", err);
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [config]);

  const handleCopy = async () => {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[HostPairingQR] clipboard write failed:", err);
    }
  };

  if (!config) {
    return (
      <div
        data-testid="host-pairing-qr-empty"
        className="rounded-md border border-outline-variant/30 bg-surface-container-high/40 px-4 py-3"
      >
        <p className="text-sm text-on-surface font-medium">Pairing QR unavailable</p>
        <p className="text-xs text-on-surface-variant mt-1">
          Pick a server before generating a pairing code — the QR encodes
          the server your phone is currently connected to so another phone
          can join the same instance.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="host-pairing-qr"
      className="rounded-md border border-outline-variant/30 bg-surface-container-low/60 px-4 py-3 space-y-3"
    >
      <div>
        <h4 className="text-sm font-medium text-on-surface">Pairing QR</h4>
        <p className="text-xs text-on-surface-variant mt-1">
          Scan this with another phone's Concord app to join the same
          instance without typing the hostname.
        </p>
      </div>
      <div className="flex items-center justify-center">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Pairing QR code"
            width={256}
            height={256}
            data-testid="host-pairing-qr-image"
            className="rounded bg-white p-2"
          />
        ) : (
          <div
            className="w-64 h-64 rounded bg-surface-container-high/40 flex items-center justify-center text-xs text-on-surface-variant"
            data-testid="host-pairing-qr-loading"
          >
            Generating QR…
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <code
          className="flex-1 text-xs text-on-surface-variant bg-surface-container-high/60 px-2 py-1.5 rounded truncate"
          data-testid="host-pairing-qr-url"
        >
          {pairingUrl ?? ""}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!pairingUrl}
          data-testid="host-pairing-qr-copy"
          className="px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/15 text-primary rounded disabled:opacity-40"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
