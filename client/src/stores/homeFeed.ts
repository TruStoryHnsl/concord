/**
 * homeFeed — the native personal-messenger "front door" conversation feed.
 *
 * This is a DERIVED PROJECTION, not a new source of selection truth. Exactly
 * like `navStack` is a navigation overlay on top of the existing selection
 * stores, `homeFeed` merges four existing stores into ONE sorted
 * `Conversation[]`:
 *
 *   - DM rooms          ← `stores/dm`        (kind: "dm")
 *   - paired peers       ← `stores/peerStore` (kind: "peer")
 *   - docker sources     ← `stores/sources`   (kind: "docker") — every
 *                          ConcordSource that is NOT the local instance
 *   - the local porch    ← intrinsic          (kind: "local")
 *
 * The merge/sort/filter helpers below are PURE and exported so the
 * aggregation contract can be unit-tested directly (Cycle 3, cold session).
 * The React-side gathering (matrix display names, unread counts, last
 * activity) lives in `components/home/useHomeFeed.ts`, which feeds resolved
 * inputs into these mappers — the store itself never imports React or
 * matrix-js-sdk so it stays a thin, testable projection.
 *
 * The Zustand store proper (`useHomeFeedStore`) holds ONLY the Home
 * surface's own UI state — search query, active filter tab, which row is
 * highlighted, whether the front door or the underlying ChatLayout is
 * showing, and a one-shot "open this conversation" intent that ChatLayout
 * consumes to route into the existing navStack drill-down. None of that is
 * selection truth; it's purely the front-door's local view state.
 */

import { create } from "zustand";
import type { ConcordSource } from "./sources";
import { isLocalInstanceSource } from "../lib/sourceIdentity";
import { inferSourceBrand } from "../components/sources/sourceBrand";

/** Discriminated conversation kind — drives the row variant. */
export type ConversationKind = "peer" | "dm" | "docker" | "local";

/** Filter tabs under the search bar. */
export type HomeFilter = "all" | "people" | "sources" | "unread";

/** Presence shown on a person row. */
export type PresenceState = "online" | "away" | "offline";

/**
 * How to OPEN a conversation. The front door raises one of these as a
 * one-shot intent; ChatLayout consumes it and routes into the existing
 * navStack drill-down / DM view (see the native pendingOpen effect in
 * ChatLayout). This is the seam Cycle 2 replaces for peer/dm with a native
 * messenger chat surface.
 */
export type HomeOpenTarget =
  | { kind: "dm"; roomId: string; sourceId?: string }
  | { kind: "peer"; peerId: string }
  | { kind: "docker"; sourceId: string }
  | { kind: "local"; sourceId?: string };

/** Branding subset a docker row needs to render its business-chat treatment. */
export type DockerSourceRef = Pick<
  ConcordSource,
  "host" | "instanceName" | "serverName" | "platform" | "status" | "branding"
>;

/**
 * One merged conversation. Carries everything a row needs to render AND
 * the `target` describing how to open it. `id` is stable and kind-prefixed
 * so it is unique across kinds and survives re-sorts.
 */
export interface Conversation {
  id: string;
  kind: ConversationKind;
  displayName: string;
  preview?: string;
  /** Epoch ms — the sort key (most-recent first). */
  lastActivityTs: number;
  /** Pre-formatted display timestamp (e.g. "10:42 AM"), if any. */
  timestamp?: string;
  unreadCount: number;
  pinned?: boolean;
  target: HomeOpenTarget;

  // ── per-kind render refs ────────────────────────────────────────────
  /** peer/dm */
  userId?: string;
  avatarUrl?: string;
  presence?: PresenceState;
  federationLabel?: string;
  /** docker */
  source?: DockerSourceRef;
  /** local */
  localLabel?: string;
}

/* ──────────────────────────────────────────────────────────────────────
 * Pure mappers + merge/sort/filter (unit-testable; no React, no matrix)
 * ────────────────────────────────────────────────────────────────────── */

export interface DmInput {
  roomId: string;
  userId: string;
  sourceId?: string;
  displayName: string;
  preview?: string;
  unreadCount: number;
  /** Epoch ms; fall back to created_at on the caller side. */
  lastActivityTs: number;
  timestamp?: string;
  pinned?: boolean;
  federationLabel?: string;
}

export interface PeerInput {
  peerId: string;
  displayName: string;
  /** Epoch ms (typically Date.parse(lastSeen)). */
  lastActivityTs: number;
  online: boolean;
}

export function dmToConversation(input: DmInput): Conversation {
  return {
    id: `dm:${input.roomId}`,
    kind: "dm",
    displayName: input.displayName,
    preview: input.preview,
    lastActivityTs: input.lastActivityTs,
    timestamp: input.timestamp,
    unreadCount: input.unreadCount,
    pinned: input.pinned,
    userId: input.userId,
    federationLabel: input.federationLabel,
    target: { kind: "dm", roomId: input.roomId, sourceId: input.sourceId },
  };
}

export function peerToConversation(input: PeerInput): Conversation {
  return {
    id: `peer:${input.peerId}`,
    kind: "peer",
    displayName: input.displayName,
    preview: undefined,
    lastActivityTs: input.lastActivityTs,
    unreadCount: 0,
    presence: input.online ? "online" : "offline",
    target: { kind: "peer", peerId: input.peerId },
  };
}

export function sourceToConversation(source: ConcordSource): Conversation {
  const ref: DockerSourceRef = {
    host: source.host,
    instanceName: source.instanceName,
    serverName: source.serverName,
    platform: source.platform,
    status: source.status,
    branding: source.branding,
  };
  const preview =
    source.status === "connected"
      ? source.instanceName ?? source.host
      : `${source.host} · ${source.status}`;
  return {
    id: `docker:${source.id}`,
    kind: "docker",
    displayName: source.instanceName ?? source.host,
    preview,
    // No real message activity for a source row — order by when it was
    // added so freshly-connected sources surface near recent chats.
    lastActivityTs: Date.parse(source.addedAt) || 0,
    unreadCount: 0,
    source: ref,
    target: { kind: "docker", sourceId: source.id },
  };
}

export function localToConversation(input: {
  label: string;
  lastActivityTs: number;
  sourceId?: string;
}): Conversation {
  return {
    id: `local:${input.sourceId ?? "porch"}`,
    kind: "local",
    displayName: input.label,
    preview: "Your space",
    lastActivityTs: input.lastActivityTs,
    unreadCount: 0,
    localLabel: "LOCAL",
    target: { kind: "local", sourceId: input.sourceId },
  };
}

/** Is this source eligible to render as a docker conversation row? */
export function isDockerConversationSource(source: ConcordSource): boolean {
  return !isLocalInstanceSource(source);
}

/**
 * Stable, most-recent-first sort. Pinned rows float to the top (preserving
 * recency order within the pinned group); ties break on displayName so the
 * order is deterministic for tests.
 */
export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (b.lastActivityTs !== a.lastActivityTs) {
      return b.lastActivityTs - a.lastActivityTs;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Merge every kind's conversations into one sorted list. */
export function mergeConversations(parts: {
  dms?: Conversation[];
  peers?: Conversation[];
  dockers?: Conversation[];
  local?: Conversation | null;
}): Conversation[] {
  const merged: Conversation[] = [
    ...(parts.local ? [parts.local] : []),
    ...(parts.dms ?? []),
    ...(parts.peers ?? []),
    ...(parts.dockers ?? []),
  ];
  return sortConversations(merged);
}

/** Search/filter selector — by name+preview text and by filter tab. */
export function filterConversations(
  list: Conversation[],
  query: string,
  filter: HomeFilter,
): Conversation[] {
  const needle = query.trim().toLowerCase();
  return list.filter((c) => {
    if (filter === "people" && !(c.kind === "peer" || c.kind === "dm")) {
      return false;
    }
    if (filter === "sources" && !(c.kind === "docker" || c.kind === "local")) {
      return false;
    }
    if (filter === "unread" && c.unreadCount <= 0) return false;
    if (!needle) return true;
    const haystack = [c.displayName, c.preview]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** Re-export so row code can derive a brand without re-importing sourceBrand. */
export { inferSourceBrand };

/* ──────────────────────────────────────────────────────────────────────
 * The store: front-door UI state only (no selection truth duplicated)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Which surface the native front door is showing.
 *  - `home`        — the conversation list (+ empty detail on desktop).
 *  - `native-chat` — the messenger chat surface for a peer/DM conversation,
 *                    rendered INSIDE the front-door layer (Cycle 2 / WS-C).
 *  - `handoff`     — the front door steps aside and reveals the underlying
 *                    ChatLayout (docker source / local porch drill-down,
 *                    add-source, settings). Cycle 1 called this `chat`.
 * Web ignores this entirely.
 */
export type HomeSurface = "home" | "native-chat" | "handoff";

/**
 * The peer/DM conversation currently open on the native messenger chat
 * surface. Carries the presentational bits the header needs plus the
 * matrix `roomId` the existing message hooks bind to. `roomId` is absent
 * for a bare peer with no DM room yet (see WS-C seam).
 */
export interface ActiveNativeChat {
  conversationId: string;
  kind: "peer" | "dm";
  displayName: string;
  roomId?: string;
  sourceId?: string;
  userId?: string;
  presence?: PresenceState;
  avatarUrl?: string;
  federationLabel?: string;
}

/** Identity shown in the docker-handoff header (WS-D). */
export interface DockerHandoff {
  sourceId: string;
  title: string;
  subtitle?: string;
  source?: DockerSourceRef;
}

interface HomeFeedState {
  query: string;
  filter: HomeFilter;
  selectedConversationId: string | null;
  /** Native: which front-door surface is showing. Web ignores this. */
  surface: HomeSurface;
  /** One-shot open intent consumed by ChatLayout's native routing effect
   *  (docker / local / bare-peer handoff only). */
  pendingOpen: HomeOpenTarget | null;
  /** The peer/DM conversation open on the native chat surface, if any. */
  activeChat: ActiveNativeChat | null;
  /** Identity for the docker-handoff header overlay, if a source is open. */
  dockerHandoff: DockerHandoff | null;

  setQuery: (query: string) => void;
  setFilter: (filter: HomeFilter) => void;
  setSelected: (id: string | null) => void;
  /**
   * Open a conversation from a Home row. Branches on kind:
   *  - dm           → native messenger chat surface (WS-C).
   *  - peer (room)  → native chat surface if a roomId is supplied.
   *  - peer (no room), docker, local → reveal ChatLayout via `pendingOpen`.
   */
  openConversation: (conv: Conversation) => void;
  /** Raise a raw open intent + reveal the underlying ChatLayout. Kept for
   *  the pair-peer / add-source shortcuts that don't have a full row. */
  requestOpen: (target: HomeOpenTarget, conversationId?: string) => void;
  /** ChatLayout calls this once it has routed the pending intent. */
  consumePendingOpen: () => HomeOpenTarget | null;
  /** Reveal the underlying ChatLayout without raising an open intent
   *  (used to surface the voice bar when a 1:1 call starts, and by the
   *  add-source / settings entries). */
  showHandoff: () => void;
  /** Return to the front door, clearing any open chat / handoff state. */
  goHome: () => void;
}

export const useHomeFeedStore = create<HomeFeedState>((set, get) => ({
  query: "",
  filter: "all",
  selectedConversationId: null,
  surface: "home",
  pendingOpen: null,
  activeChat: null,
  dockerHandoff: null,

  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  setSelected: (selectedConversationId) => set({ selectedConversationId }),

  openConversation: (conv) => {
    // A DM is the only kind that already owns a matrix room, so it is the
    // one that lands on the native messenger chat surface. A bare peer has
    // no room→message linkage yet (KnownPeer carries no matrix user/room —
    // WS-C seam), so it falls through to the existing peers surface.
    if (conv.target.kind === "dm") {
      set({
        surface: "native-chat",
        selectedConversationId: conv.id,
        pendingOpen: null,
        dockerHandoff: null,
        activeChat: {
          conversationId: conv.id,
          kind: "dm",
          displayName: conv.displayName,
          roomId: conv.target.roomId,
          sourceId: conv.target.sourceId,
          userId: conv.userId,
          presence: conv.presence,
          avatarUrl: conv.avatarUrl,
          federationLabel: conv.federationLabel,
        },
      });
      return;
    }
    // docker / local / bare-peer → reveal the existing ChatLayout drill-down.
    set({
      surface: "handoff",
      selectedConversationId: conv.id,
      pendingOpen: conv.target,
      activeChat: null,
      dockerHandoff:
        conv.kind === "docker"
          ? {
              sourceId: (conv.target as { sourceId: string }).sourceId,
              title: conv.displayName,
              subtitle: conv.preview,
              source: conv.source,
            }
          : null,
    });
  },

  requestOpen: (target, conversationId) =>
    set({
      pendingOpen: target,
      surface: "handoff",
      activeChat: null,
      dockerHandoff: null,
      selectedConversationId: conversationId ?? get().selectedConversationId,
    }),

  consumePendingOpen: () => {
    const pending = get().pendingOpen;
    if (pending) set({ pendingOpen: null });
    return pending;
  },

  showHandoff: () => set({ surface: "handoff" }),

  goHome: () =>
    set({ surface: "home", activeChat: null, dockerHandoff: null }),
}));
