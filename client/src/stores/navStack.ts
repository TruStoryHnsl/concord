/**
 * navStack — explicit hierarchical navigation stack (Zustand).
 *
 * Replaces the old CSS scroll-snap "page-depth" strip (a flat
 * `sources | servers | channels | chat` enum) with a real navigation
 * stack that is the single source of truth for BOTH the phone and the
 * desktop projections of ChatLayout.
 *
 *   - Phone (`< md`, touch): render ONLY the top-of-stack frame; drill-in
 *     pushes a frame (slide-left-in), back pops (slide-right-out). The
 *     stack itself provides the back affordance and place retention.
 *   - Tablet/desktop (`>= md` OR `isIPad`): the multi-column layout reads
 *     selection from `useServerStore`/`useSourcesStore`/`useDMStore`
 *     directly and is unaffected by this stack — but the same stack still
 *     tells it which column is "focused" on the narrow→wide transition.
 *
 * This module is a NAVIGATION OVERLAY, not a re-implementation of
 * selection. Selection truth stays in the existing stores; a `NavFrame`
 * only records *where in the drill-down hierarchy* the user is, plus
 * enough selection context to rebuild intermediate frames on a deep-link
 * restore. See `client/src/stores/sources.ts` / `server.ts` for the
 * matching Zustand patterns.
 *
 * The headline bug this fixes: voice/room connect used to reflow the
 * scroll strip mid-scroll, which re-snapped to the nearest panel, read
 * `scrollLeft ≈ 0`, and slammed `mobileView` back to `"sources"`. With a
 * stack, connecting is a pure no-op / `replaceTop`; the chat frame stays
 * on top by construction, so there is no "reset to leftmost".
 */

import { create } from "zustand";

/** The four hierarchical drill-down levels (matches the old PAGE_DEPTH). */
export type NavLevel = "sources" | "servers" | "channels" | "chat";

/** A non-hierarchical full-screen overlay that sits ON TOP of the stack. */
export type NavOverlay = "dms" | "settings" | null;

/**
 * One frame on the navigation stack. A frame remembers its own
 * selection context so `pop()` lands the user back on the exact branch
 * they drilled in from — never at `sources`.
 */
export interface NavFrame {
  level: NavLevel;
  /** Source this frame belongs to. null = the local/porch source. */
  sourceId: string | null;
  /** Server selected at/above this frame, if any. */
  serverId: string | null;
  /** Channel selected at/above this frame, if any. */
  channelId: string | null;
  /** When the chat frame is a DM (not a server channel), the DM room id. */
  dmRoomId: string | null;
  /**
   * Optional keyed list-position cache so a `pop()` back to a list frame
   * can restore the same scroll/branch position. Wiring the actual
   * scroll restore is deferred; the field exists so frames can carry it.
   */
  listScrollKey?: string;
}

/** Patch shape accepted by `push` — `level` is required, rest optional. */
export type NavFramePatch = Partial<NavFrame> & { level: NavLevel };

export interface NavState {
  /**
   * The drill-down stack. `stack[0]` is ALWAYS a `sources` root, so the
   * stack is never empty and `pop()` can always fall back to it.
   */
  stack: NavFrame[];
  /** Active full-screen overlay (dms/settings) or null. */
  overlay: NavOverlay;

  /** Push a new frame. Inherits unspecified selection context from the top. */
  push: (frame: NavFramePatch) => void;
  /** Pop the top frame. No-op at depth 1 (the root is permanent). */
  pop: () => void;
  /** Patch the top frame in place (sibling-channel switch, etc.). */
  replaceTop: (patch: Partial<NavFrame>) => void;
  /**
   * Collapse the stack so that `level` is the top frame. If a frame at
   * that level already exists, truncates to it (preserving its context);
   * otherwise synthesizes intermediate frames up from the root using the
   * current top frame's selection context.
   */
  resetToLevel: (level: NavLevel) => void;
  /** Set (or clear) the active overlay. */
  setOverlay: (overlay: NavOverlay) => void;
  /** Replace the entire stack wholesale (tab switch / deep-link restore). */
  setStack: (stack: NavFrame[], overlay?: NavOverlay) => void;
}

/** Ordering of the hierarchy — index = drill depth. */
export const NAV_LEVEL_ORDER: NavLevel[] = [
  "sources",
  "servers",
  "channels",
  "chat",
];

/** A fresh `sources` root frame with empty selection context. */
export function rootFrame(): NavFrame {
  return {
    level: "sources",
    sourceId: null,
    serverId: null,
    channelId: null,
    dmRoomId: null,
  };
}

/**
 * Carry selection context forward from an existing frame onto a partial
 * patch, so a `push({ level: "chat" })` keeps the server/channel the user
 * was browsing without the caller having to restate it.
 */
function withInheritedContext(base: NavFrame, patch: NavFramePatch): NavFrame {
  return {
    level: patch.level,
    sourceId: patch.sourceId !== undefined ? patch.sourceId : base.sourceId,
    serverId: patch.serverId !== undefined ? patch.serverId : base.serverId,
    channelId: patch.channelId !== undefined ? patch.channelId : base.channelId,
    dmRoomId: patch.dmRoomId !== undefined ? patch.dmRoomId : base.dmRoomId,
    listScrollKey:
      patch.listScrollKey !== undefined
        ? patch.listScrollKey
        : undefined,
  };
}

/**
 * Synthesize a stack whose top frame is `level`, building intermediate
 * frames up from the root and carrying `context` selection into each.
 * Used by `resetToLevel` (when no matching frame is already present) and
 * by the deep-link rehydrate seam.
 */
export function buildStackToLevel(
  level: NavLevel,
  context: Partial<NavFrame> = {},
): NavFrame[] {
  const targetIdx = NAV_LEVEL_ORDER.indexOf(level);
  const idx = targetIdx < 0 ? 0 : targetIdx;
  const frames: NavFrame[] = [];
  for (let i = 0; i <= idx; i++) {
    frames.push({
      level: NAV_LEVEL_ORDER[i],
      sourceId: context.sourceId ?? null,
      serverId: context.serverId ?? null,
      channelId: context.channelId ?? null,
      dmRoomId: context.dmRoomId ?? null,
    });
  }
  return frames;
}

export const useNavStack = create<NavState>()((set) => ({
  stack: [rootFrame()],
  overlay: null,

  push: (frame) => {
    set((state) => {
      const top = state.stack[state.stack.length - 1] ?? rootFrame();
      const next = withInheritedContext(top, frame);
      // Pushing the SAME level the top is already on is a replaceTop, not
      // a duplicate push — switching siblings should not deepen the stack.
      if (top.level === next.level) {
        const stack = state.stack.slice(0, -1);
        stack.push(next);
        return { stack };
      }
      return { stack: [...state.stack, next] };
    });
  },

  pop: () => {
    set((state) => {
      if (state.stack.length <= 1) return state;
      return { stack: state.stack.slice(0, -1) };
    });
  },

  replaceTop: (patch) => {
    set((state) => {
      if (state.stack.length === 0) return { stack: [{ ...rootFrame(), ...patch }] };
      const stack = state.stack.slice();
      const top = stack[stack.length - 1];
      stack[stack.length - 1] = { ...top, ...patch };
      return { stack };
    });
  },

  resetToLevel: (level) => {
    set((state) => {
      const existingIdx = state.stack.findIndex((f) => f.level === level);
      if (existingIdx >= 0) {
        // Truncate to the existing frame — preserves its branch context
        // so back-from-deeper lands exactly where the user branched.
        return { stack: state.stack.slice(0, existingIdx + 1) };
      }
      // No frame at that level yet — synthesize up from the current top's
      // selection context (e.g. jumping straight to "chat").
      const top = state.stack[state.stack.length - 1] ?? rootFrame();
      return { stack: buildStackToLevel(level, top) };
    });
  },

  setOverlay: (overlay) => set({ overlay }),

  setStack: (stack, overlay) =>
    set(() => ({
      stack: stack.length > 0 ? stack : [rootFrame()],
      ...(overlay !== undefined ? { overlay } : {}),
    })),
}));

/** Convenience selector: the current top-of-stack frame. */
export function navTop(state: Pick<NavState, "stack">): NavFrame {
  return state.stack[state.stack.length - 1] ?? rootFrame();
}

/* ──────────────────────────────────────────────────────────────────────
 * old-BrowseTab → NavStack mapper
 *
 * The pre-existing ChatLayout multi-tab model (`BrowseTab`) stored a flat
 * `pageView` enum plus the selected server/channel/DM. The migration seam
 * converts a BrowseTab into an equivalent NavStack so existing call-sites
 * (the ~30 `setMobileView` callers and the per-tab state) keep working
 * while the renderer is swapped underneath them.
 * ────────────────────────────────────────────────────────────────────── */

/**
 * The legacy per-tab navigation shape. Mirrors the `BrowseTab` interface
 * in ChatLayout (kept local to avoid a circular import). `pageView` is the
 * old flat enum; `dmActive`/`dmRoomId` capture the DM branch.
 */
export interface LegacyBrowseTab {
  pageView: NavLevel;
  serverId: string | null;
  channelId: string | null;
  dmActive: boolean;
  dmRoomId: string | null;
}

/**
 * Map a legacy `BrowseTab` to a NavStack (stack of frames). The flat
 * `pageView` becomes the top level; intermediate frames are synthesized so
 * `pop()` has a working back path. A DM-active chat tab produces a `chat`
 * frame carrying `dmRoomId` (and no serverId), matching the spec's
 * "DM pushes {level:'chat', dmRoomId}" distinct-branch rule.
 */
export function browseTabToStack(tab: LegacyBrowseTab): NavFrame[] {
  const isDmChat = tab.pageView === "chat" && tab.dmActive && !!tab.dmRoomId;
  const context: Partial<NavFrame> = {
    sourceId: null,
    serverId: isDmChat ? null : tab.serverId,
    channelId: isDmChat ? null : tab.channelId,
    dmRoomId: isDmChat ? tab.dmRoomId : null,
  };
  return buildStackToLevel(tab.pageView, context);
}
