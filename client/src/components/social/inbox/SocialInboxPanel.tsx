/**
 * Component home: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * Per-peer 1:1 inbox list + conversation view + unread tracking. The
 * per-peer-inboxes branch owns everything under
 * `client/src/components/social/inbox/`. Base branch ships this placeholder
 * so the directory + import path exist and the build compiles.
 */
import { socialInboxList } from "../../../api/social/inbox";

export function SocialInboxPanel() {
  void socialInboxList;
  return null;
}
