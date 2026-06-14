/**
 * LocalChatPane — message area for the active porch channel.
 *
 * Reuses MessageList + MessageInput so the visual surface is
 * byte-identical to a Matrix text channel. The data layer is the
 * source-kind-aware piece: porchStore records (`ChannelMessage`) are
 * adapted into the renderer's `ChatMessage` shape at the call boundary
 * so MessageList consumes them unchanged.
 *
 * Mapping notes:
 *  - `ChannelMessage.author_peer_id` becomes the `sender`. The porch
 *    has no Matrix-style user identity for visitors, so the author id
 *    is resolved to the friendliest handle the local node already
 *    knows: the peer's Identify vanity name from the LAN snapshot when
 *    present, otherwise a shortened peer-id (first 8 characters) rather
 *    than the full hex string.
 *  - `ChannelMessage.created_at` (unix ms) maps straight to
 *    `ChatMessage.timestamp`.
 *  - Reactions / edits / file uploads / typing indicators are not part
 *    of the porch protocol yet. The MessageList + MessageInput shape
 *    accommodates them as no-ops; future porch phases can wire them
 *    in without changing this component's external contract.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "../../hooks/useMatrix";
import { usePorchStore } from "../../stores/porchStore";
import { useLocalServerSelectionStore } from "../../stores/localServerSelection";
import { useHomeServerNameStore } from "../../stores/homeServerName";
import { MessageList } from "../chat/MessageList";
import { MessageInput } from "../chat/MessageInput";
import { BringingUpSplash } from "../BringingUpSplash";
import { isTauri } from "../../api/servitude";
import {
  fetchLanPeersSnapshot,
  subscribeToLanPeers,
  vanityNameFromAgentVersion,
} from "../../api/lanPeers";
import { FirstLaunchTwoNameBanner } from "./FirstLaunchTwoNameBanner";

/**
 * Shorten a raw peer-id to its first 8 characters for display. Used as
 * the fallback when no friendlier handle is known for the author.
 */
function shortPeerId(peerId: string): string {
  return peerId.length > 8 ? peerId.slice(0, 8) : peerId;
}

/**
 * Resolve a porch message author's raw peer-id to a display handle:
 * the peer's Identify vanity name if the LAN snapshot carries one,
 * otherwise the shortened peer-id.
 */
function resolveAuthor(
  peerId: string,
  vanityByPeerId: ReadonlyMap<string, string>,
): string {
  return vanityByPeerId.get(peerId) ?? shortPeerId(peerId);
}

function porchToChatMessage(
  m: {
    id: string;
    author_peer_id: string;
    body: string;
    created_at: number;
  },
  vanityByPeerId: ReadonlyMap<string, string>,
): ChatMessage {
  return {
    id: m.id,
    sender: resolveAuthor(m.author_peer_id, vanityByPeerId),
    body: m.body,
    timestamp: m.created_at,
    redacted: false,
    edited: false,
    msgtype: "m.text",
    url: null,
    reactions: [],
  };
}

export function LocalChatPane() {
  const isNative = isTauri();
  const channels = usePorchStore((s) => s.channels);
  const selectedChannelId = usePorchStore((s) => s.selectedChannelId);
  const messages = usePorchStore((s) => s.messages);
  const isLoaded = usePorchStore((s) => s.isLoaded);
  const isLoading = usePorchStore((s) => s.isLoading);
  const error = usePorchStore((s) => s.error);
  const sendMessage = usePorchStore((s) => s.sendMessage);

  // F1b-IMPL — surface the active server's label in BringingUpSplash
  // status strings + the "desktop-only" empty state so the user
  // never sees stale "porch" copy when they're actually reading the
  // home server.
  const active = useLocalServerSelectionStore((s) => s.active);
  const homeName = useHomeServerNameStore((s) => s.name);
  const serverLabel =
    active === "home" ? homeName.trim() || "home" : "porch";

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  // peer-id → Identify vanity name, hydrated from the LAN snapshot and
  // kept current via the discovery event stream. Used to render porch
  // message authors with a friendlier handle than the raw peer-id.
  const [vanityByPeerId, setVanityByPeerId] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const peers = await fetchLanPeersSnapshot();
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const p of peers) {
          const name = vanityNameFromAgentVersion(p.agentVersion);
          if (name) next.set(p.peerId, name);
        }
        setVanityByPeerId(next);
      } catch {
        // Snapshot read failed (e.g. swarm not up yet) — authors fall
        // back to the shortened peer-id, which is always renderable.
      }
    };

    void refresh();
    const unsubscribe = subscribeToLanPeers(() => void refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isNative]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const chatMessages = useMemo(
    () => messages.map((m) => porchToChatMessage(m, vanityByPeerId)),
    [messages, vanityByPeerId],
  );

  const handleSend = useCallback(
    async (body: string) => {
      await sendMessage(body);
    },
    [sendMessage],
  );

  // Edit / file / reaction handlers are no-ops for porch Phase A —
  // the protocol doesn't carry those yet. Wired as resolved promises
  // so MessageList's prop contract stays satisfied without changes.
  const noopAsync = useCallback(async () => {}, []);

  // Web build: porch is desktop-only. Reuse the splash to mirror the
  // "we're waiting on a hosted service" affordance and surface a
  // status string the user can read.
  if (!isNative) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <BringingUpSplash
          size="compact"
          status={`The ${serverLabel} server lives on your desktop install`}
        />
      </div>
    );
  }

  // Still loading the initial channel list.
  if (!isLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <BringingUpSplash
          size="compact"
          status={`Loading ${serverLabel}…`}
        />
      </div>
    );
  }

  if (error && error !== "native_only") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-error font-body">{error}</p>
      </div>
    );
  }

  if (!selectedChannel) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-on-surface-variant font-body">
          Select a channel to start chatting
        </p>
      </div>
    );
  }

  const emptyState = (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      <FirstLaunchTwoNameBanner />
      <p className="text-base text-on-surface font-body">
        Be the first to say something!
      </p>
    </div>
  );

  return (
    <>
      <MessageList
        messages={chatMessages}
        isPaginating={isLoading}
        hasMore={false}
        onLoadMore={noopAsync}
        // The porch has no Matrix user-id — surface this as "anonymous"
        // so the MessageList "own message" gating never lights up. A
        // future phase will plumb the local peer-id through here.
        currentUserId={null}
        isServerOwner={false}
        onDelete={noopAsync}
        onStartEdit={setEditingMessage}
        onReact={noopAsync}
        onRemoveReaction={noopAsync}
        emptyState={emptyState}
      />
      <MessageInput
        onSend={handleSend}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        roomName={selectedChannel.name}
      />
    </>
  );
}
