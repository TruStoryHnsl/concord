import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DMConversation } from "../api/concord";
import { listDMs, listDMsAt, createDM as apiCreateDM } from "../api/concord";
import { useToastStore } from "./toast";
import { useSourcesStore } from "./sources";

/**
 * Merge DM lists fetched from multiple sources into ONE profile-keyed list.
 * Each entry is tagged with the source it came from; duplicates (same Matrix
 * room reachable from more than one account) collapse to the first seen.
 * Pure + exported so the aggregation contract is unit-tested directly.
 */
export function mergeDMConversations(
  perSource: { sourceId?: string; convs: DMConversation[] }[],
): DMConversation[] {
  const byRoom = new Map<string, DMConversation>();
  for (const { sourceId, convs } of perSource) {
    for (const c of convs) {
      if (byRoom.has(c.matrix_room_id)) continue;
      byRoom.set(c.matrix_room_id, { ...c, sourceId: c.sourceId ?? sourceId });
    }
  }
  return [...byRoom.values()];
}

interface DMState {
  conversations: DMConversation[];
  activeDMRoomId: string | null;
  dmActive: boolean; // true = DM context, false = server context
  pinnedRoomIds: string[];

  loadConversations: (accessToken: string) => Promise<void>;
  startDM: (targetUserId: string, accessToken: string) => Promise<string>; // returns roomId
  setActiveDM: (roomId: string | null) => void;
  setDMActive: (active: boolean) => void;
  togglePinnedRoom: (roomId: string) => void;

  activeConversation: () => DMConversation | undefined;
}

export const useDMStore = create<DMState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeDMRoomId: null,
      dmActive: false,
      pinnedRoomIds: [],

      loadConversations: async (accessToken) => {
        // Aggregate the superuser's DMs across EVERY connected source they
        // hold auth for — the native app delivers each source's token to its
        // own instance and merges the results into one profile-keyed list, so
        // the user's DMs follow them everywhere. One bad source never aborts
        // the others. On the web build (no per-source tokens) this falls back
        // to the active session alone.
        const authedSources = useSourcesStore
          .getState()
          .sources.filter(
            (s) =>
              s.enabled &&
              (s.platform ?? "concord") === "concord" &&
              !!s.accessToken &&
              !!s.apiBase,
          );
        const perSource: { sourceId?: string; convs: DMConversation[] }[] = [];
        if (authedSources.length === 0) {
          try {
            perSource.push({ convs: await listDMs(accessToken) });
          } catch (err) {
            useToastStore.getState().addToast(
              err instanceof Error ? err.message : "Failed to load DMs",
            );
          }
        } else {
          await Promise.all(
            authedSources.map(async (s) => {
              try {
                const convs = await listDMsAt(s.apiBase, s.accessToken as string);
                perSource.push({ sourceId: s.id, convs });
              } catch {
                /* one source failing must not drop the others' DMs */
              }
            }),
          );
        }
        const conversations = mergeDMConversations(perSource);
        set((state) => ({
          conversations,
          pinnedRoomIds: state.pinnedRoomIds.filter((roomId) =>
            conversations.some((conversation) => conversation.matrix_room_id === roomId),
          ),
        }));
      },

      startDM: async (targetUserId, accessToken) => {
        const result = await apiCreateDM(targetUserId, accessToken);

        if (result.created) {
          // Append to conversations list
          set((s) => ({
            conversations: [
              {
                id: result.id,
                other_user_id: result.target_user_id,
                matrix_room_id: result.matrix_room_id,
                created_at: new Date().toISOString(),
              },
              ...s.conversations,
            ],
          }));
        }

        set({
          activeDMRoomId: result.matrix_room_id,
          dmActive: true,
        });

        return result.matrix_room_id;
      },

      setActiveDM: (roomId) => {
        set({ activeDMRoomId: roomId });
      },

      setDMActive: (active) => {
        set({ dmActive: active });
        if (!active) {
          set({ activeDMRoomId: null });
        }
      },

      togglePinnedRoom: (roomId) => {
        set((state) => ({
          pinnedRoomIds: state.pinnedRoomIds.includes(roomId)
            ? state.pinnedRoomIds.filter((id) => id !== roomId)
            : [...state.pinnedRoomIds, roomId],
        }));
      },

      activeConversation: () => {
        const { conversations, activeDMRoomId } = get();
        return conversations.find((c) => c.matrix_room_id === activeDMRoomId);
      },
    }),
    {
      name: "concord_dm_state",
      partialize: (state) => ({
        pinnedRoomIds: state.pinnedRoomIds,
      }),
    },
  ),
);
