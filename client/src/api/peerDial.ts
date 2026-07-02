/**
 * P2P-FR-002 — unified "connect to a paired peer" entry point.
 *
 * This is the single call-site the UI uses to turn an intentional pairing
 * into a live p2p connection. It hides the native/web split:
 *
 *   - **Native (Tauri):** invokes the `peer_dial` Rust command, which looks
 *     the peer up in the Stronghold-backed peer store and queues a real
 *     `swarm.dial(...)` against the running servitude swarm. Resolves once
 *     the dial is *queued*; the connection outcome arrives asynchronously on
 *     the `peer_swarm_event` bus (`DialSuccess` / `DialFailure`).
 *
 *   - **Web (browser):** ensures the browser libp2p node is running and
 *     calls `dialPairedPeer(node, peer)` — which dials ONLY the peer's
 *     stored multiaddrs (no discovery). Resolves once `node.dial` returns a
 *     connection (or throws on failure).
 *
 * Both paths consult zero discovery — they dial exactly the addresses
 * learned at pairing time, matching the 2026-05-29 explicit-pairing
 * architecture. Access-revoked peers are refused on both sides (the native
 * command and `dialPairedPeer` each guard `accessGranted`).
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./servitude";
import type { KnownPeer } from "./peerStore";
import { ensureBrowserNode } from "../libp2p/lazyNode";
import { dialPairedPeer } from "../libp2p/pairedDial";

/**
 * Connect to a stored paired peer. See the module docstring for the
 * native-vs-web behavioural difference (queued vs. awaited).
 *
 * Throws on the web path if the dial fails (no usable multiaddrs, access
 * revoked, unreachable). On native, throws only if the command itself
 * rejects (peer not found, revoked, no addresses, swarm not running) — an
 * unreachable peer surfaces later as a `DialFailure` swarm event, not here.
 */
export async function connectToPeer(
  peer: KnownPeer,
  // WS-4 — optionally front this dial under a specific persona (DB slug).
  // When provided (native), the peer is re-tagged to that persona so the
  // connection joins that persona's mesh neighborhood only. Omitted ⇒ the
  // peer's existing persona binding is preserved (backward compatible).
  personaId?: string,
): Promise<void> {
  if (isTauri()) {
    await invoke("peer_dial", {
      peerId: peer.peerId,
      ...(personaId !== undefined ? { personaId } : {}),
    });
    return;
  }
  const node = await ensureBrowserNode();
  await dialPairedPeer(node, peer);
}
