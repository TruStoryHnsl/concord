/**
 * Hook: **p2p groups** (OWNED by the tertiary engine-ui track).
 *
 * Owns the renderer-side state for p2p groups: the group list, the
 * currently-open group's transcript, and the mutating actions (create /
 * open / send / refresh). Wraps the `social_group_*` Tauri commands via
 * `../../../api/social/groups`. Self-contained — does NOT reach into the
 * Matrix stores so the p2p group surface stands on its own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  socialGroupCreate,
  socialGroupList,
  socialGroupMessages,
  socialGroupSend,
} from "../../../api/social/groups";
import type { GroupRecord } from "../../../api/social/groups";
import type { InboxMessage } from "../../../api/social/types";

export interface GroupsState {
  /** Every group this store holds, newest-created first. */
  groups: GroupRecord[];
  /** Group id of the open group, or null when none is selected. */
  activeGroupId: string | null;
  /** Messages of the open group, oldest-first. */
  messages: InboxMessage[];
  /** True while the group list is (re)loading. */
  loadingList: boolean;
  /** True while the open group's transcript is (re)loading. */
  loadingMessages: boolean;
  /** True while a create is in flight. */
  creating: boolean;
  /** Last error surfaced by any command, or null. */
  error: string | null;
  /** Select (open) a group; loads its transcript. */
  openGroup: (groupId: string) => void;
  /** Create a group with the given name + other-member peer ids. */
  createGroup: (name: string, members: string[]) => Promise<boolean>;
  /** Send an outbound message to the active group. */
  send: (body: string) => Promise<void>;
  /** Re-fetch the group list (e.g. after inbound delivery). */
  refresh: () => Promise<void>;
}

export function useGroups(): GroupsState {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the active group in a ref so async callbacks can guard against a
  // stale response landing after the user switched groups.
  const activeGroupRef = useRef<string | null>(null);
  activeGroupRef.current = activeGroupId;

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await socialGroupList();
      setGroups(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (groupId: string) => {
    setLoadingMessages(true);
    try {
      const msgs = await socialGroupMessages(groupId);
      // Drop the response if the user has since switched groups.
      if (activeGroupRef.current === groupId) {
        setMessages(msgs);
        setError(null);
      }
    } catch (e) {
      if (activeGroupRef.current === groupId) setError(String(e));
    } finally {
      if (activeGroupRef.current === groupId) setLoadingMessages(false);
    }
  }, []);

  const openGroup = useCallback(
    (groupId: string) => {
      setActiveGroupId(groupId);
      activeGroupRef.current = groupId;
      setMessages([]);
      void loadMessages(groupId);
    },
    [loadMessages],
  );

  const createGroup = useCallback(
    async (name: string, members: string[]) => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      setCreating(true);
      try {
        const group = await socialGroupCreate(trimmed, members);
        setError(null);
        await refresh();
        openGroup(group.group_id);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        setCreating(false);
      }
    },
    [refresh, openGroup],
  );

  const send = useCallback(
    async (body: string) => {
      const groupId = activeGroupRef.current;
      if (!groupId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      try {
        const msg = await socialGroupSend(groupId, trimmed);
        // Optimistically append to the open transcript if still on this group.
        if (activeGroupRef.current === groupId) {
          setMessages((prev) => [...prev, msg]);
        }
        setError(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  // Initial load of the group list.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    groups,
    activeGroupId,
    messages,
    loadingList,
    loadingMessages,
    creating,
    error,
    openGroup,
    createGroup,
    send,
    refresh,
  };
}
