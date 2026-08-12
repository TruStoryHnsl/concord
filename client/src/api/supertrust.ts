/**
 * C2 / NUI-F35 — supertrust device-link escalation API wrapper.
 *
 * Thin wrappers around the `supertrust_*` Tauri commands exposed by
 * `src-tauri/src/lib.rs` (implementations in
 * `src-tauri/src/commands/supertrust.rs`). Together with
 * `porchLinkPersonalDevice` (`./porch.ts`) they are the client surface of
 * the bilateral supertrust escalation handshake:
 *
 *   - `supertrustLinkCandidates` — paired-but-not-yet-linked peers the
 *     user could escalate from Settings → Devices.
 *   - `supertrustRespond` — the RESPONDER half: arms a one-shot consent
 *     for exactly one inbound link request from exactly one peer.
 *
 * The handshake is deliberately halved: the responder's inbound handler
 * refuses to sign anything unless consent was independently armed on THAT
 * machine, and the initiator (`porchLinkPersonalDevice`) can only commit
 * after verifying an Accept it could not have produced itself. One device
 * therefore cannot claim another; nothing here arms consent implicitly.
 *
 * Native-only — browsers hold no porch and no peer store.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./servitude";

/**
 * One paired peer that is NOT yet one of this install's own devices.
 * Mirrors the Rust `SupertrustLinkCandidate` (camelCase via serde).
 */
export interface SupertrustLinkCandidate {
  peerId: string;
  /** Known-peers registry label, or null — render an id-derived stand-in. */
  label: string | null;
  /** Introduction source: "qr" | "deeplink" | "matrix_room" | "dht" |
   *  "proximity" | "mdns". */
  source: string;
  /** NUI-F29 — the peer's DEVICE fingerprint (grouped for reading aloud).
   *  Empty when the key could not be recovered from the peer id; the
   *  confirmation must then say "nothing to compare" rather than render a
   *  blank next to a trust prompt. */
  deviceFingerprint: string;
  /** NUI-F30 — true when the peer was paired by exchanging peer cards
   *  (which carry the OWNER key the supertrust Offer is signed with).
   *  Discovery-paired peers (mDNS / DHT) store the DEVICE key and cannot
   *  complete the handshake — fail-closed on the far side. */
  cardPaired: boolean;
}

/** Every access-granted peer that is not already a linked device. */
export async function supertrustLinkCandidates(): Promise<
  SupertrustLinkCandidate[]
> {
  if (!isTauri()) return [];
  return await invoke<SupertrustLinkCandidate[]>("supertrust_link_candidates");
}

/**
 * RESPONDER half — arm (accept=true) or deny (accept=false) a ONE-SHOT
 * consent for an inbound device-link request from `peerId`.
 *
 * Arming grants nothing on its own: it signs nothing, links nothing, and
 * changes no trust tier. It records that IF that exact peer presents a
 * valid, fresh, correctly-addressed Offer, this device agrees to sign it
 * — once. The inbound handler consumes it exactly once, so a second
 * attempt needs a second explicit act.
 */
export async function supertrustRespond(
  peerId: string,
  accept: boolean,
): Promise<boolean> {
  if (!isTauri()) {
    throw new Error("supertrust_respond is native-only");
  }
  return await invoke<boolean>("supertrust_respond", { peerId, accept });
}
