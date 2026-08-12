/**
 * Porch Phase F — Personal devices tab.
 *
 * Surfaces the user's linked personal devices (phone + laptop + desktop
 * all bound to the same identity) plus the "Add personal device" form.
 *
 * Two roles in one component:
 *
 *   1. **My personal devices** — peers the local user has escalated to
 *      personal-device status. Per-row Sync now + Unlink actions; status
 *      badges showing `last_sync_at` so the user can tell which device
 *      is in sync.
 *
 *   2. **Background auto-sync** — a 60-second timer kicks
 *      `porch_sync_all_personal_devices` while the tab is mounted, so
 *      the user gets eventually-consistent state across devices
 *      without having to mash buttons. Errors per-peer surface as
 *      badges; transient failures don't block the next round.
 *
 * NEW links are NOT created here. The free-text "add device by peer-id"
 * form this component originally carried predated the C2 supertrust
 * escalation and bypassed the confirmation + device-fingerprint check the
 * NUI-F35 flow requires, so it was absorbed by the "Link another of your
 * devices" section in `settings/DevicesTab.tsx` — the section that mounts
 * this component.
 *
 * Native only — browsers don't host a porch.
 */

import { useEffect, useState } from "react";
import {
  type DeviceLink,
  type SyncReport,
  porchListDeviceLinks,
  porchSyncAllPersonalDevices,
  porchSyncNow,
  porchUnlinkDevice,
} from "../../api/porch";

/** 60s background auto-sync interval. Long enough to be cheap; short
 *  enough that a freshly-posted message on one device shows up on
 *  another within a minute. The Phase F spec leaves this knob to the
 *  implementer; a 5-minute global cadence is the alternative if 60s
 *  proves too chatty.
 */
const AUTO_SYNC_INTERVAL_MS = 60_000;

export function PersonalDevices() {
  const [links, setLinks] = useState<DeviceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingPeerId, setPendingPeerId] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [lastReports, setLastReports] = useState<Record<string, SyncReport>>({});

  const reload = async () => {
    setLoading(true);
    try {
      const list = await porchListDeviceLinks();
      setLinks(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Background auto-sync. Runs while this tab is mounted; unmounts
  // (e.g. the user clicks away to Channels) stop the loop.
  useEffect(() => {
    const tick = async () => {
      try {
        const reports = await porchSyncAllPersonalDevices();
        const indexed: Record<string, SyncReport> = {};
        for (const r of reports) {
          indexed[r.peer_id] = r;
        }
        setLastReports(indexed);
        // Refresh `last_sync_at` badges by reloading the link list.
        void reload();
      } catch (e) {
        // Transient failures (network blip, peer offline) are expected
        // — surface as a non-blocking error message but keep ticking.
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    const handle = setInterval(() => void tick(), AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncNow = async (peerId: string) => {
    setPendingPeerId(peerId);
    setError(null);
    try {
      const report = await porchSyncNow(peerId);
      setLastReports((prev) => ({ ...prev, [peerId]: report }));
      if (report.error) {
        setError(`Sync failed for ${shortPeerId(peerId)}: ${report.error}`);
      } else {
        const pulled = sumCounts(report.pulled_count_per_table);
        const pushed = sumCounts(report.pushed_count_per_table);
        setToast(
          `Sync ok with ${shortPeerId(peerId)}: ${pulled} pulled / ${pushed} pushed.`,
        );
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingPeerId(null);
    }
  };

  const handleConfirmUnlink = async () => {
    if (!confirmUnlink) return;
    const peer = confirmUnlink;
    setConfirmUnlink(null);
    try {
      await porchUnlinkDevice(peer);
      setToast(`Unlinked ${shortPeerId(peer)}.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      data-testid="personal-devices"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: "var(--surface, #18191c)",
        color: "var(--on-surface, #e3e4e6)",
      }}
    >
      {/* "My personal devices" — list + Sync now + Unlink */}
      <section
        style={{
          background: "var(--surface-container, #1f2125)",
          border: "1px solid var(--outline-variant, #2a2c30)",
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            opacity: 0.8,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>My personal devices</span>
        </div>

        {loading ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>Loading…</div>
        ) : links.length === 0 ? (
          <div
            style={{ fontSize: 13, opacity: 0.6, fontStyle: "italic" }}
            data-testid="personal-devices-empty"
          >
            No personal devices linked yet. Link one from the “Link another of
            your devices” section above.
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {links.map((link) => {
              const report = lastReports[link.peer_id];
              return (
                <li
                  key={link.peer_id}
                  data-testid={`personal-device-row-${link.peer_id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {link.label || shortPeerId(link.peer_id)}
                    <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.5 }}>
                      {syncBadge(link, report)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSyncNow(link.peer_id)}
                    disabled={pendingPeerId === link.peer_id}
                    data-testid={`personal-sync-now-${link.peer_id}`}
                    style={smallButtonStyle}
                  >
                    {pendingPeerId === link.peer_id ? "Syncing…" : "Sync now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmUnlink(link.peer_id)}
                    data-testid={`personal-unlink-${link.peer_id}`}
                    style={smallButtonStyle}
                  >
                    Unlink
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Unlink confirmation */}
      {confirmUnlink && (
        <div
          data-testid="personal-unlink-confirm-modal"
          style={{
            background: "var(--surface-container, #1f2125)",
            border: "1px solid var(--outline-variant, #2a2c30)",
            borderRadius: 8,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13 }}>
            Unlink {shortPeerId(confirmUnlink)}? Sync will stop until you
            re-link this device.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => void handleConfirmUnlink()}
              data-testid="personal-unlink-confirm-yes"
              style={{
                fontSize: 12,
                background: "var(--error, #e57373)",
                border: 0,
                color: "white",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Unlink
            </button>
            <button
              type="button"
              onClick={() => setConfirmUnlink(null)}
              data-testid="personal-unlink-confirm-cancel"
              style={{
                fontSize: 12,
                background: "transparent",
                border: "1px solid var(--outline-variant, #2a2c30)",
                color: "inherit",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast + error surfaces */}
      {toast && (
        <div
          data-testid="personal-toast"
          style={{
            fontSize: 12,
            background: "rgba(124, 77, 255, 0.12)",
            border: "1px solid rgba(124, 77, 255, 0.3)",
            color: "var(--on-surface, #e3e4e6)",
            padding: "4px 10px",
            borderRadius: 4,
          }}
        >
          {toast}
        </div>
      )}
      {error && (
        <div
          data-testid="personal-error"
          style={{
            fontSize: 12,
            color: "var(--error, #e57373)",
            background: "rgba(229, 115, 115, 0.08)",
            padding: "4px 10px",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

const smallButtonStyle: React.CSSProperties = {
  fontSize: 11,
  background: "transparent",
  border: "1px solid var(--outline-variant, #2a2c30)",
  color: "inherit",
  padding: "2px 8px",
  borderRadius: 4,
  cursor: "pointer",
};

function shortPeerId(peerId: string): string {
  if (peerId.length <= 14) return peerId;
  return `${peerId.slice(0, 8)}…${peerId.slice(-4)}`;
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

function syncBadge(link: DeviceLink, report?: SyncReport): string {
  if (report?.error) {
    return `· error: ${report.error}`;
  }
  if (link.last_sync_at == null) {
    return "· never synced";
  }
  const ago = relativeTime(link.last_sync_at);
  return `· last sync ${ago}`;
}

function relativeTime(unixMs: number): string {
  const delta = Date.now() - unixMs;
  if (delta < 60_000) return "just now";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / 60 / 60_000)}h ago`;
  return `${Math.floor(delta / 24 / 60 / 60_000)}d ago`;
}

export default PersonalDevices;
