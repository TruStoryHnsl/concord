/**
 * API wrapper: **known-peers-registry** (OWNED by the known-peers branch).
 *
 * Thin wrappers around the `social_peers_*` / `social_peer_*` Tauri commands.
 * Base-branch state: registered, returning NotImplemented until the feature
 * lands. Owned by the known-peers branch; extend WITHOUT touching the other
 * `social/*` api files. Shared types come from `./types` (read-only).
 */
import { invoke } from "@tauri-apps/api/core";
import type { PeerRecord, SocialTrust } from "./types";

/** List tracked peers, optionally sorted by a feature-defined key. */
export function socialPeersList(sortBy?: string): Promise<PeerRecord[]> {
  return invoke<PeerRecord[]>("social_peers_list", { sortBy });
}

/** Set (or clear) the owner label on a peer. */
export function socialPeerSetLabel(
  peerId: string,
  label: string | null,
): Promise<PeerRecord> {
  return invoke<PeerRecord>("social_peer_set_label", { peerId, label });
}

/** Set the trust level on a peer. */
export function socialPeerSetTrust(
  peerId: string,
  trust: SocialTrust,
): Promise<PeerRecord> {
  return invoke<PeerRecord>("social_peer_set_trust", { peerId, trust });
}

/** Forget a tracked peer. */
export function socialPeerForget(peerId: string): Promise<void> {
  return invoke<void>("social_peer_forget", { peerId });
}
