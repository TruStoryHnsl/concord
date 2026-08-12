/**
 * NUI-F24 — LAN auto-pair opt-in surface.
 *
 * Renders inside Settings → Connections (UserConnectionsTab) next to
 * `PeerConnectionsSection` / `TunnelHardeningSection`. One switch:
 * "Automatically pair with devices on this network", backed by
 * `ServitudeConfig.lan_auto_pair` (default OFF).
 *
 * The copy states what the toggle actually does — including that incoming
 * messages from auto-paired peers are accepted — and what it does NOT do:
 * a peer the user declined stays declined, and a revoked peer is never
 * re-granted (both properties enforced engine-side by
 * `peer_store::auto_pair` / `add`, regardless of this flag).
 *
 * Takes effect at the next mDNS broadcast, no node restart: the
 * swarm-event mirror re-reads the flag per discovered peer.
 *
 * Web build: placeholder only — a browser tab runs no mDNS discovery.
 */

import { useEffect, useState } from "react";

import { getLanAutoPair, setLanAutoPair } from "../../../api/lanAutoPair";
import { isTauri } from "../../../api/servitude";
import { useToastStore } from "../../../stores/toast";

export function LanAutoPairSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await getLanAutoPair();
        if (!cancelled) setEnabled(value);
      } catch (err) {
        if (!cancelled) {
          addToast(
            `Couldn't load LAN auto-pair setting: ${
              err instanceof Error ? err.message : String(err)
            }`,
            "error",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  const handleToggle = async () => {
    if (enabled === null) return;
    const next = !enabled;
    setIsSaving(true);
    try {
      await setLanAutoPair(next);
      setEnabled(next);
      addToast(
        next
          ? "LAN auto-pair is on — devices discovered on this network pair automatically from the next broadcast."
          : "LAN auto-pair is off — pairing is explicit again.",
        "success",
      );
    } catch (err) {
      addToast(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!isTauri()) {
    return (
      <div
        className="border-t border-outline-variant/20 pt-6 space-y-2"
        data-testid="lan-auto-pair-section"
      >
        <h4 className="text-sm font-headline font-semibold text-on-surface">
          Local network pairing
        </h4>
        <p className="text-xs text-on-surface-variant">
          Pairs devices discovered on the same network automatically.
          Available in the desktop app, which runs local network discovery;
          the web build does not.
        </p>
      </div>
    );
  }

  return (
    <div
      className="border-t border-outline-variant/20 pt-6 space-y-4"
      data-testid="lan-auto-pair-section"
    >
      <div>
        <h4 className="text-sm font-headline font-semibold text-on-surface">
          Local network pairing
        </h4>
        <p className="text-xs text-on-surface-variant mt-1">
          When on, a device discovered on your local network (same Wi-Fi) is
          paired automatically — on both sides, since both run discovery —
          and incoming messages from it are accepted. Devices you declined
          stay declined, and peers you revoked are not re-granted. When off,
          pairing stays explicit: you approve each device.
        </p>
      </div>

      <div className="flex items-center justify-between py-2 gap-3">
        <div className="flex flex-col">
          <span className="text-sm text-on-surface">
            Automatically pair with devices on this network
          </span>
          <span className="text-xs text-on-surface-variant">
            Takes effect at the next discovery broadcast — no restart needed
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label="Toggle LAN auto-pair"
          disabled={isSaving || enabled === null}
          onClick={() => void handleToggle()}
          data-testid="lan-auto-pair-toggle"
          className={
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors " +
            (enabled
              ? "bg-primary"
              : "bg-surface-container-high border border-outline-variant/40") +
            (isSaving || enabled === null ? " opacity-50" : "")
          }
        >
          <span
            className={
              "inline-block h-4 w-4 transform rounded-full bg-on-surface transition-transform " +
              (enabled ? "translate-x-6" : "translate-x-1")
            }
          />
        </button>
      </div>
    </div>
  );
}
