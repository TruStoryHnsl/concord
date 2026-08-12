import { memo, useState, useEffect } from "react";
import { useDMStore } from "../../stores/dm";
import { useAuthStore } from "../../stores/auth";
import { DMListItem } from "./DMListItem";
import { NewDMModal } from "./NewDMModal";
import { isTauri } from "../../api/servitude";
import { fetchRoamedHistory } from "../../lib/messengerSync";
import { usePeerMessengerSurfaceStore } from "../../stores/peerMessengerSurface";
import { identiconDataUri } from "../mesh/identicon";

interface DMSidebarProps {
  mobile?: boolean;
  onDMSelect?: (roomId: string) => void;
}

export const DMSidebar = memo(function DMSidebar({ mobile, onDMSelect }: DMSidebarProps) {
  const conversations = useDMStore((s) => s.conversations);
  const activeDMRoomId = useDMStore((s) => s.activeDMRoomId);
  const setActiveDM = useDMStore((s) => s.setActiveDM);
  const loadConversations = useDMStore((s) => s.loadConversations);
  const pinnedRoomIds = useDMStore((s) => s.pinnedRoomIds);
  const togglePinnedRoom = useDMStore((s) => s.togglePinnedRoom);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [showNewDM, setShowNewDM] = useState(false);

  // Superuser roaming (web): the ONE inbox also lists the p2p
  // conversations the user's native device pushed to this instance.
  // Opening one shows the read-only device history — no second inbox
  // tile anywhere.
  const [roamed, setRoamed] = useState<
    Array<{ key: string; label: string; preview: string | null }>
  >([]);
  useEffect(() => {
    if (isTauri() || !accessToken) return;
    void fetchRoamedHistory()
      .then((r) => {
        const contacts = r.contacts;
        setRoamed(
          r.conversations
            .sort((a, b) =>
              String(b.data.lastMessageAt ?? "").localeCompare(
                String(a.data.lastMessageAt ?? ""),
              ),
            )
            .slice(0, 100)
            .map((c) => {
              const contactLabel = contacts.find((x) => x.key === c.key)?.data
                ?.label;
              const gn = c.data.groupName;
              const label =
                (typeof gn === "string" && gn) ||
                (typeof contactLabel === "string" && contactLabel) ||
                (c.key.length > 20
                  ? `${c.key.slice(0, 10)}…${c.key.slice(-6)}`
                  : c.key);
              return {
                key: c.key,
                label,
                preview:
                  typeof c.data.lastPreview === "string"
                    ? c.data.lastPreview
                    : null,
              };
            }),
        );
      })
      .catch(() => {});
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) {
      loadConversations(accessToken);
    }
  }, [accessToken, loadConversations]);

  const handleSelect = (roomId: string) => {
    setActiveDM(roomId);
    onDMSelect?.(roomId);
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-surface-container-low">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
        <h3 className="text-xs font-label font-medium text-on-surface-variant uppercase tracking-widest">
          Direct Messages
        </h3>
        <button
          onClick={() => setShowNewDM(true)}
          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          title="New Message"
        >
          <span className="material-symbols-outlined text-lg">edit_square</span>
        </button>
      </div>

      {/* Conversation list */}
      <div className={`flex-1 overflow-y-auto ${mobile ? "p-3" : "p-2"}`}>
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 gap-2">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">
              chat_bubble
            </span>
            <p className="text-on-surface-variant text-sm text-center font-body">
              No conversations yet
            </p>
            <button
              onClick={() => setShowNewDM(true)}
              className="text-xs text-primary hover:text-primary/80 font-label transition-colors"
            >
              Start a conversation
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((dm) => (
              <DMListItem
                key={dm.id}
                otherUserId={dm.other_user_id}
                matrixRoomId={dm.matrix_room_id}
                isActive={activeDMRoomId === dm.matrix_room_id}
                pinned={pinnedRoomIds.includes(dm.matrix_room_id)}
                onTogglePin={() => togglePinnedRoom(dm.matrix_room_id)}
                onClick={() => handleSelect(dm.matrix_room_id)}
              />
            ))}
          </div>
        )}
      </div>

      {roamed.length > 0 && (
        <div className="border-t border-outline-variant/10 px-2 py-2" data-testid="dm-roamed-section">
          <div className="px-2 pb-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            From your device
          </div>
          {roamed.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() =>
                usePeerMessengerSurfaceStore.getState().openConversation(c.key)
              }
              className="btn-press mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-container-high"
              data-testid={`dm-roamed-${c.key}`}
            >
              <img src={identiconDataUri(c.key)} alt="" className="h-6 w-6 rounded" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-on-surface">{c.label}</span>
                {c.preview ? (
                  <span className="block truncate text-[11px] text-on-surface-variant">
                    {c.preview}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}

      {showNewDM && <NewDMModal onClose={() => setShowNewDM(false)} />}
    </div>
  );
});
