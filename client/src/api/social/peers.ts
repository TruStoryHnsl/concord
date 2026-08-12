/**
 * API wrapper: **known-peers-registry** (OWNED by the known-peers branch).
 *
 * Thin wrappers around the `social_peers_*` / `social_peer_*` Tauri commands.
 * The Rust side persists a sortable [`PeerRecord`] registry under the app
 * local data dir (plaintext JSON view layered on the encrypted peer_store —
 * see `src-tauri/src/servitude/social/known_peers.rs`).
 *
 * Owned by the known-peers branch; extend WITHOUT touching the other
 * `social/*` api files. Shared types come from `./types` (read-only — frozen
 * by the base branch).
 *
 * Web build: these commands are native-only (they touch the on-disk
 * registry). Callers guard with `isTauri()` and render a native-only
 * placeholder — same convention as `peerStore.ts` / `concordUser.ts`.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../servitude";
import type { PeerRecord, SocialTrust } from "./types";

export { isTauri };

/**
 * Sort key the registry understands. Mirrors the Rust `SortKey` enum's wire
 * strings in `social/known_peers.rs`. `"lastSeen"` is the default (and what
 * an unknown key falls back to on the backend).
 */
export type SocialPeerSort = "lastSeen" | "firstSeen" | "label" | "trust";

/** List tracked peers, optionally sorted by a registry sort key. */
export function socialPeersList(sortBy?: SocialPeerSort): Promise<PeerRecord[]> {
  return invoke<PeerRecord[]>("social_peers_list", { sortBy });
}

/**
 * Set (or clear, with `null`) the owner label on a peer. Empty / whitespace
 * labels are normalized to "cleared" on the backend. Returns the updated
 * record.
 */
export function socialPeerSetLabel(
  peerId: string,
  label: string | null,
): Promise<PeerRecord> {
  return invoke<PeerRecord>("social_peer_set_label", { peerId, label });
}

/** Set the trust level on a peer. Returns the updated record. */
export function socialPeerSetTrust(
  peerId: string,
  trust: SocialTrust,
): Promise<PeerRecord> {
  return invoke<PeerRecord>("social_peer_set_trust", { peerId, trust });
}

/**
 * Forget a tracked peer (drops the social-graph view row only; the
 * underlying peer_store pairing is unaffected). Idempotent.
 */
export function socialPeerForget(peerId: string): Promise<void> {
  return invoke<void>("social_peer_forget", { peerId });
}
