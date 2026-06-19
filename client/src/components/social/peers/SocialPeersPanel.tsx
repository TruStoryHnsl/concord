/**
 * Component home: **known-peers-registry** (OWNED by the known-peers branch).
 *
 * Sortable known-peers list + per-peer label/trust controls. The known-peers
 * branch owns everything under `client/src/components/social/peers/`. Base
 * branch ships this placeholder so the directory + import path exist and the
 * build compiles.
 */
import { socialPeersList } from "../../../api/social/peers";

export function SocialPeersPanel() {
  void socialPeersList;
  return null;
}
