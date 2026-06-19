/**
 * Component home: **known-peers-registry** (OWNED by the known-peers branch).
 *
 * Sortable known-peers list + per-peer label/trust controls. The known-peers
 * branch owns everything under `client/src/components/social/peers/`.
 *
 * Renders the persistent social registry (`social_peers_list`), which folds
 * in already-paired peer_store entries on the backend. Each row shows a short
 * fingerprint, the owner label (editable inline), a trust-tier selector, a
 * relative "last seen" timestamp, and a Forget action. A sort selector at the
 * top re-queries the backend with the chosen key.
 *
 * Design tokens follow the rest of the app (`text-on-surface-variant`,
 * `bg-surface-container-high`, …) so it sits visually alongside the existing
 * `peers/KnownPeersList`.
 */
import { useCallback, useEffect, useState } from "react";

import {
  isTauri,
  socialPeerForget,
  socialPeerSetLabel,
  socialPeerSetTrust,
  socialPeersList,
  type SocialPeerSort,
} from "../../../api/social/peers";
import type { PeerRecord, SocialTrust } from "../../../api/social/types";
import { useToastStore } from "../../../stores/toast";

/** Human-readable label for each sort key, in the order they appear. */
const SORT_OPTIONS: { key: SocialPeerSort; label: string }[] = [
  { key: "lastSeen", label: "Last seen" },
  { key: "firstSeen", label: "First seen" },
  { key: "label", label: "Label" },
  { key: "trust", label: "Trust" },
];

/** Display label + ordering for each trust tier. */
const TRUST_OPTIONS: { value: SocialTrust; label: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "recent", label: "Recent" },
  { value: "friend", label: "Friend" },
  { value: "closeFriend", label: "Close friend" },
  { value: "supertrusted", label: "Supertrusted" },
];

const TRUST_LABEL: Record<SocialTrust, string> = Object.fromEntries(
  TRUST_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SocialTrust, string>;

/**
 * Format an RFC3339 timestamp as a short relative-time string. Inline helper
 * (four bands) rather than pulling a date dep — mirrors `KnownPeersList`.
 */
function relativeTime(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const deltaSec = Math.max(0, Math.floor((now - parsed) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay}d ago`;
}

export function SocialPeersPanel() {
  const addToast = useToastStore((s) => s.addToast);
  const [peers, setPeers] = useState<PeerRecord[]>([]);
  const [sort, setSort] = useState<SocialPeerSort>("lastSeen");
  const [loading, setLoading] = useState(true);
  const native = isTauri();

  const reload = useCallback(
    async (sortKey: SocialPeerSort) => {
      if (!native) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const next = await socialPeersList(sortKey);
        setPeers(next);
      } catch (err) {
        addToast(
          `Could not load peers: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [native, addToast],
  );

  useEffect(() => {
    void reload(sort);
  }, [reload, sort]);

  // ---- per-row mutations (optimistic-with-reconcile) --------------------

  const applyUpdated = useCallback((updated: PeerRecord) => {
    setPeers((prev) =>
      prev.map((p) => (p.peerId === updated.peerId ? updated : p)),
    );
  }, []);

  const handleSetLabel = useCallback(
    async (peerId: string, label: string | null) => {
      try {
        const updated = await socialPeerSetLabel(peerId, label);
        applyUpdated(updated);
      } catch (err) {
        addToast(
          `Could not save label: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Reconcile from source of truth on failure.
        void reload(sort);
      }
    },
    [applyUpdated, addToast, reload, sort],
  );

  const handleSetTrust = useCallback(
    async (peerId: string, trust: SocialTrust) => {
      try {
        const updated = await socialPeerSetTrust(peerId, trust);
        applyUpdated(updated);
        // A trust change can reorder a trust-sorted list.
        if (sort === "trust") void reload(sort);
      } catch (err) {
        addToast(
          `Could not set trust: ${err instanceof Error ? err.message : String(err)}`,
        );
        void reload(sort);
      }
    },
    [applyUpdated, addToast, reload, sort],
  );

  const handleForget = useCallback(
    async (peerId: string) => {
      const ok =
        typeof window !== "undefined" &&
        window.confirm(
          `Forget peer ${peerId.slice(0, 12)}…?\nThis only removes the social-list entry; the underlying pairing is unaffected.`,
        );
      if (!ok) return;
      // Optimistic removal.
      setPeers((prev) => prev.filter((p) => p.peerId !== peerId));
      try {
        await socialPeerForget(peerId);
        addToast("Peer forgotten", "success");
      } catch (err) {
        addToast(
          `Could not forget peer: ${err instanceof Error ? err.message : String(err)}`,
        );
        void reload(sort);
      }
    },
    [addToast, reload, sort],
  );

  // ---- render ------------------------------------------------------------

  if (!native) {
    return (
      <p className="text-xs text-on-surface-variant italic">
        The known-peers registry is available in the desktop app.
      </p>
    );
  }

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="social-peers-panel"
      aria-label="Known peers"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-on-surface">Known peers</h3>
        <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          Sort
          <select
            className="bg-surface-container-high text-on-surface text-xs rounded px-1.5 py-0.5"
            value={sort}
            onChange={(e) => setSort(e.target.value as SocialPeerSort)}
            data-testid="social-peers-sort"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {loading && peers.length === 0 ? (
        <p className="text-xs text-on-surface-variant italic">Loading peers…</p>
      ) : peers.length === 0 ? (
        <p className="text-xs text-on-surface-variant italic">
          No known peers yet. Peers you discover or pair with appear here.
        </p>
      ) : (
        <ul className="space-y-1">
          {peers.map((peer) => (
            <li key={peer.peerId}>
              <PeerRow
                peer={peer}
                onSetLabel={handleSetLabel}
                onSetTrust={handleSetTrust}
                onForget={handleForget}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PeerRow({
  peer,
  onSetLabel,
  onSetTrust,
  onForget,
}: {
  peer: PeerRecord;
  onSetLabel: (peerId: string, label: string | null) => void;
  onSetTrust: (peerId: string, trust: SocialTrust) => void;
  onForget: (peerId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(peer.label ?? "");

  const commitLabel = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    // No-op if unchanged.
    if ((peer.label ?? "") === (next ?? "")) return;
    onSetLabel(peer.peerId, next);
  };

  return (
    <div
      className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-surface-container-high"
      data-testid={`social-peer-row-${peer.peerId}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="text-sm bg-surface-container-high text-on-surface rounded px-1.5 py-0.5 min-w-0 flex-1"
            value={draft}
            placeholder="Label…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setDraft(peer.label ?? "");
                setEditing(false);
              }
            }}
            data-testid={`social-peer-label-input-${peer.peerId}`}
          />
        ) : (
          <button
            type="button"
            className="text-sm text-on-surface truncate text-left hover:underline"
            title={peer.label ? "Click to edit label" : "Click to add a label"}
            onClick={() => {
              setDraft(peer.label ?? "");
              setEditing(true);
            }}
            data-testid={`social-peer-label-${peer.peerId}`}
          >
            {peer.label ?? (
              <span className="italic text-on-surface-variant">
                {peer.peerId.slice(0, 12)}…
              </span>
            )}
          </button>
        )}
        {peer.label && (
          <span
            className="text-xs text-on-surface-variant font-mono truncate"
            title={peer.peerId}
          >
            {peer.peerId.slice(0, 8)}…
          </span>
        )}
      </div>

      <span
        className="text-xs text-on-surface-variant whitespace-nowrap"
        title={`Last seen ${peer.lastSeen}`}
      >
        {relativeTime(peer.lastSeen)}
      </span>

      <select
        className="bg-surface-container-high text-on-surface text-xs rounded px-1.5 py-0.5"
        value={peer.trust}
        onChange={(e) => onSetTrust(peer.peerId, e.target.value as SocialTrust)}
        title={`Trust: ${TRUST_LABEL[peer.trust]}`}
        data-testid={`social-peer-trust-${peer.peerId}`}
      >
        {TRUST_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="text-xs text-on-surface-variant hover:text-error px-1"
        title="Forget peer"
        onClick={() => onForget(peer.peerId)}
        data-testid={`social-peer-forget-${peer.peerId}`}
      >
        ✕
      </button>
    </div>
  );
}
