import { useCallback } from "react";
import { useDMStore } from "../../../stores/dm";
import { useServerStore } from "../../../stores/server";
import {
  useNavStack,
  navTop,
  type NavLevel,
  type NavFrame,
  type NavOverlay,
} from "../../../stores/navStack";

export type MobileView =
  | "sources"
  | "servers"
  | "channels"
  | "chat"
  | "dms"
  | "settings";

export interface NavBridge {
  navStack: NavFrame[];
  navOverlay: NavOverlay;
  navPop: () => void;
  /** The view seen by the rest of ChatLayout (overlay wins, else top frame). */
  mobileView: MobileView;
  setMobileView: (view: MobileView) => void;
  handleMobileChannelSelect: (roomId: string) => void;
  handleMobileDMSelect: (roomId: string) => void;
}

/**
 * The navStack ↔ stores bridge. The navStack store is the single source
 * of truth for the mobile view; this hook exposes the compatibility
 * surface ChatLayout's render path consumes:
 *
 *   - `mobileView` — overlay if active, else top-of-stack frame's level.
 *   - `setMobileView` — overlay views set the overlay; page-depth views
 *     clear it and collapse/extend the stack (preserving branch context
 *     so a server→channels→chat path popped to "channels" lands on the
 *     SAME server — the headline nav bug fix).
 *   - drill-in push helpers for channel / DM selection on mobile.
 *
 * Extracted verbatim from ChatLayout.
 */
export function useNavBridge(activeServerId: string | null): NavBridge {
  const navStack = useNavStack((s) => s.stack);
  const navOverlay = useNavStack((s) => s.overlay);
  const navResetToLevel = useNavStack((s) => s.resetToLevel);
  const navSetOverlay = useNavStack((s) => s.setOverlay);
  const navPop = useNavStack((s) => s.pop);

  const setActiveDM = useDMStore((s) => s.setActiveDM);
  const origSetActiveChannel = useServerStore((s) => s.setActiveChannel);

  const mobileView: MobileView = navOverlay ?? navTop({ stack: navStack }).level;

  const setMobileView = useCallback(
    (view: MobileView) => {
      if (view === "dms" || view === "settings") {
        navSetOverlay(view);
      } else {
        navSetOverlay(null);
        navResetToLevel(view as NavLevel);
      }
    },
    [navSetOverlay, navResetToLevel],
  );

  // When selecting a channel on mobile, push a chat frame onto the nav
  // stack (carrying the selected channel + active server context) so that
  // `pop()` returns to THIS server's channel list.
  const handleMobileChannelSelect = useCallback(
    (roomId: string) => {
      origSetActiveChannel(roomId);
      useDMStore.getState().setDMActive(false);
      useNavStack.getState().push({
        level: "chat",
        serverId: activeServerId,
        channelId: roomId,
        dmRoomId: null,
      });
    },
    [origSetActiveChannel, activeServerId],
  );

  // When selecting a DM on mobile, push a chat frame that is a DISTINCT
  // branch (dmRoomId set, no serverId) — back pops out of the DM rather
  // than into a server channel list.
  const handleMobileDMSelect = useCallback(
    (roomId: string) => {
      setActiveDM(roomId);
      useNavStack.getState().push({
        level: "chat",
        serverId: null,
        channelId: null,
        dmRoomId: roomId,
      });
    },
    [setActiveDM],
  );

  return {
    navStack,
    navOverlay,
    navPop,
    mobileView,
    setMobileView,
    handleMobileChannelSelect,
    handleMobileDMSelect,
  };
}
