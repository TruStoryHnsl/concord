/**
 * P2P-FR-002 — browser explicit peer dialing.
 *
 * The browser swarm (`node.ts`) boots with **zero automatic discovery**:
 * no mDNS (not portable from a tab), no Kad-DHT, no bootstrap dials. The
 * only way a browser peer ever connects to another Concord instance is by
 * dialing a peer it was *intentionally paired with* — a `KnownPeer` from
 * the Phase-5 peer-card / paired-peer store (`stores/peerStoreBrowser.ts`),
 * carrying the peer's `peerId` and the `multiaddrs` learned at pairing
 * time.
 *
 * This module is that explicit-dial seam. It takes a stored `KnownPeer`
 * and dials it **using only its stored multiaddrs** — there is no address
 * lookup, no discovery service, no fallback to any ambient mechanism. If
 * the stored multiaddrs are stale (peer rebuilt, moved networks), the dial
 * simply fails; recovery is re-pairing, by design.
 *
 * Spec pointer: `docs/architecture/p2p-design.md` § Phase 4 (post-redirect
 * discovery) + Phase 9 + the P2P-FR-002 roadmap item.
 */

import { multiaddr } from "@multiformats/multiaddr";
import { peerIdFromString } from "@libp2p/peer-id";
import type { Connection, Libp2p } from "@libp2p/interface";
import type { Multiaddr } from "@multiformats/multiaddr";
import type { KnownPeer } from "../api/peerStore";
import {
  CONCORD_MATRIX_FEDERATION_PROTOCOL,
} from "./node";
import {
  sendMatrixRequest,
  type MatrixRequest,
  type MatrixResponse,
} from "./federation";

/**
 * Build the dialable multiaddr set for a paired peer.
 *
 * Each stored address is parsed and — if it does not already carry a
 * `/p2p/<peerId>` component — has the peer's id appended. libp2p needs the
 * `/p2p` suffix to bind the transport address to the expected peer identity
 * so the Noise handshake can verify it dialed the *right* peer and not a
 * man-in-the-middle squatting on the same `/ip4.../tcp...` address.
 *
 * Throws if the peer has no usable stored multiaddrs, or if the `peerId`
 * itself is malformed — both are "this pairing record is unusable, re-pair"
 * conditions, surfaced loudly rather than silently producing an empty dial.
 */
export function pairedPeerMultiaddrs(peer: KnownPeer): Multiaddr[] {
  // Validate the peer id up front so a malformed record fails here with a
  // clear message rather than deep inside libp2p's dial machinery.
  peerIdFromString(peer.peerId);
  const suffix = `/p2p/${peer.peerId}`;

  const addrs: Multiaddr[] = [];
  for (const raw of peer.multiaddrs) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    let parsed: Multiaddr;
    try {
      parsed = multiaddr(raw);
    } catch {
      // A single malformed stored address shouldn't sink the whole dial;
      // skip it and let the remaining valid addresses carry the connection.
      continue;
    }
    // Append `/p2p/<peerId>` only when the address doesn't already pin a
    // peer id. If it pins a *different* one, skip it — dialing an address
    // that claims another identity for this pairing is never correct.
    // `@multiformats/multiaddr` v13 has no `getPeerId()`; the peer id lives
    // in the `p2p` component's `value` (protocol code 421).
    const pinned =
      parsed.getComponents().find((c) => c.name === "p2p")?.value ?? null;
    if (pinned === null) {
      addrs.push(multiaddr(parsed.toString() + suffix));
    } else if (pinned === peer.peerId) {
      addrs.push(parsed);
    }
    // else: address pins a different peer id → drop it.
  }

  if (addrs.length === 0) {
    throw new Error(
      `paired peer ${peer.peerId} has no usable multiaddrs — re-pair to refresh`,
    );
  }
  return addrs;
}

/**
 * Dial a paired peer using **only** its stored multiaddrs.
 *
 * This is the single explicit entry point for browser → peer connections.
 * It performs no discovery: the addresses come straight from the pairing
 * record. A revoked peer (`accessGranted === false`) is refused — F-VIS
 * keeps revoked peers visible in the list but must not let the browser
 * reach out to them.
 *
 * Returns the established `Connection`. The caller can then open any
 * Concord subprotocol stream on it (federation, voice signaling, porch).
 */
export async function dialPairedPeer(
  node: Libp2p,
  peer: KnownPeer,
): Promise<Connection> {
  if (!peer.accessGranted) {
    throw new Error(
      `paired peer ${peer.peerId} has access revoked — grant access before dialing`,
    );
  }
  const addrs = pairedPeerMultiaddrs(peer);
  // libp2p v3 `dial` accepts an array of multiaddrs and races them,
  // returning the first connection to open. Because every address pins the
  // same `/p2p/<peerId>`, the resulting connection is guaranteed to be to
  // the expected peer or the dial rejects. No DHT, no bootstrap, no
  // ambient discovery is consulted — the address set is exactly the stored
  // pairing addresses and nothing else.
  return node.dial(addrs);
}

/**
 * Dial a paired peer (explicit, stored-multiaddr only) and send a single
 * Matrix-federation request over the established connection, returning the
 * peer's response.
 *
 * This is the browser-side end-to-end of the P2P-FR-002 acceptance: a
 * browser tab federating with a paired native/docker peer with no
 * automatic discovery in the path. `dialPairedPeer` seeds the connection
 * from stored multiaddrs; `sendMatrixRequest` then opens the
 * `/concord/matrix-federation/1.0.0` stream on it.
 */
export async function federateWithPairedPeer(
  node: Libp2p,
  peer: KnownPeer,
  request: MatrixRequest,
): Promise<MatrixResponse> {
  await dialPairedPeer(node, peer);
  // `sendMatrixRequest` dials the protocol by peer id; libp2p reuses the
  // connection `dialPairedPeer` just opened rather than dialing afresh.
  const peerId = peerIdFromString(peer.peerId);
  return sendMatrixRequest(node, peerId, request);
}

// Re-export the protocol id so call sites that only need to know "which
// stream does explicit federation ride on" don't have to import from
// `node.ts` separately.
export { CONCORD_MATRIX_FEDERATION_PROTOCOL };
