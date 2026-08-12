import { useEffect, useRef } from "react";
import { useNavStack, type NavFrame } from "../../../stores/navStack";

export interface HistoryNav {
  navDepth: number;
  navDirection: "forward" | "back";
}

/**
 * Mirrors the navStack into the History API so the browser back button
 * and the Android hardware-back gesture pop the stack instead of leaving
 * Concord. Also derives the slide-direction class for the stack-frame
 * transition. Extracted verbatim from ChatLayout.
 *
 * Loop avoidance: `popstate` ONLY drives navStack.pop() — it never
 * pushes. The depth-sync effect ONLY pushes when the stack grew ABOVE the
 * depth already recorded in `history.state`. The `navDepth` token in
 * `history.state` is the double-pop guard.
 */
export function useHistoryNav(navStack: NavFrame[]): HistoryNav {
  // Slide direction for the stack frame transition: forward when the
  // stack got deeper (drill-in), back when it shrank (pop). Compared
  // against the previous render's depth.
  const navDepth = navStack.length;
  const prevNavDepthRef = useRef(navDepth);
  const navDirection: "forward" | "back" =
    navDepth >= prevNavDepthRef.current ? "forward" : "back";
  useEffect(() => {
    prevNavDepthRef.current = navDepth;
  }, [navDepth]);

  const popstateSyncingRef = useRef(false);
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const targetDepth =
        e.state && typeof e.state.navDepth === "number"
          ? (e.state.navDepth as number)
          : 1;
      const current = useNavStack.getState().stack.length;
      // Only pop when the history entry we landed on is shallower than the
      // live stack — guards against double-pop and forward-nav no-ops.
      if (current > targetDepth) {
        popstateSyncingRef.current = true;
        // Collapse to the target depth (usually one pop, but a multi-entry
        // back swipe can skip several frames at once).
        let steps = current - targetDepth;
        while (steps-- > 0) useNavStack.getState().pop();
        popstateSyncingRef.current = false;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Push a history entry whenever the stack deepens past what history knows.
  // Skipped while a popstate is actively collapsing the stack (that motion
  // is driven BY history, so re-recording it would corrupt the back chain).
  useEffect(() => {
    if (popstateSyncingRef.current) return;
    const recorded =
      window.history.state && typeof window.history.state.navDepth === "number"
        ? (window.history.state.navDepth as number)
        : 1;
    if (navDepth > recorded) {
      // Push ONE entry per level gained so browser/hardware back can step
      // through each frame. A deep-link rehydrate jumps depth by several at
      // once (root→chat); seeding an entry per intermediate level gives that
      // refreshed-into-channel view a full back chain to sources.
      for (let d = recorded + 1; d <= navDepth; d++) {
        window.history.pushState({ navDepth: d }, "");
      }
    } else if (navDepth < recorded) {
      // Stack shrank from a non-history source (in-app back button). Align
      // the history token without adding/removing entries so the next browser
      // back maps to the correct depth.
      window.history.replaceState({ navDepth }, "");
    }
  }, [navDepth]);

  return { navDepth, navDirection };
}
