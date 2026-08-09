/**
 * API wrapper: **p2p groups** (OWNED by the tertiary engine-ui track).
 *
 * Thin wrappers around the `social_group_*` Tauri commands. The engine's
 * group store (`servitude::social::inbox`) and wire protocol
 * (`/concord/social-group/1.0.0`) are complete; these commands surface them
 * to the renderer. Shared types come from `./types` (read-only) plus the
 * group-specific `GroupRecord` declared here.
 *
 * NOTE on field naming: `GroupRecord` is serialized by the engine WITHOUT a
 * `#[serde(rename_all = "camelCase")]` attribute, so its fields arrive
 * snake_case (`group_id`, `self_peer`, …) — unlike `InboxMessage` /
 * `OwnerIdentity` which are camelCase. The interface below mirrors the wire
 * shape 1:1.
 */
import { invoke } from "@tauri-apps/api/core";
import type { InboxMessage } from "./types";

/** One p2p group as this device's store holds it. Wire shape is snake_case. */
export interface GroupRecord {
  group_id: string;
  name: string;
  /** Peer id of the creator — the only peer whose roster this store adopts. */
  creator: string;
  /** Bumped on every roster change; supersedes older rosters on members. */
  revision: number;
  /** This device's libp2p peer id, as recorded when the group was created. */
  self_peer: string;
  created_at: string;
  /** The peer whose frame first told us about this group. `null` = we created it. */
  joined_via: string | null;
  /** The roster no longer lists us. */
  removed: boolean;
  /** Every member, including this device. */
  members: string[];
}

/** Every group this store holds, newest-created first. */
export function socialGroupList(): Promise<GroupRecord[]> {
  return invoke<GroupRecord[]>("social_group_list");
}

/** Read one group. `null` when this store does not hold it. */
export function socialGroupGet(groupId: string): Promise<GroupRecord | null> {
  return invoke<GroupRecord | null>("social_group_get", { groupId });
}

/**
 * Create a group on this device. `members` are the OTHER participants (this
 * device is added automatically). Requires a live servitude runtime to learn
 * this install's libp2p peer id.
 */
export function socialGroupCreate(
  name: string,
  members: string[],
): Promise<GroupRecord> {
  return invoke<GroupRecord>("social_group_create", { name, members });
}

/** Rename a group. Creator-only. */
export function socialGroupRename(
  groupId: string,
  name: string,
): Promise<GroupRecord> {
  return invoke<GroupRecord>("social_group_rename", { groupId, name });
}

/** Replace a group's roster. Creator-only; bumps the revision. */
export function socialGroupSetMembers(
  groupId: string,
  members: string[],
): Promise<GroupRecord> {
  return invoke<GroupRecord>("social_group_set_members", { groupId, members });
}

/** Fetch a group's transcript, oldest-first. */
export function socialGroupMessages(groupId: string): Promise<InboxMessage[]> {
  return invoke<InboxMessage[]>("social_group_messages", { groupId });
}

/**
 * Send a message into a group. Persists the outbound copy locally, queues one
 * fanout row per member, and attempts live delivery to every online member.
 * The returned message's `delivery` is `"pending"` when any member's frame is
 * still queued (it flushes on that member's next connection).
 */
export function socialGroupSend(
  groupId: string,
  body: string,
): Promise<InboxMessage> {
  return invoke<InboxMessage>("social_group_send", { groupId, body });
}
