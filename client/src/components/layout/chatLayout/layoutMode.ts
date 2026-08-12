/**
 * Adaptive layout-mode decision for the chat shell.
 *
 * Extracted as a pure function so the iPad / phone / desktop / split-view
 * branching is unit-testable in isolation (the surrounding ChatLayout has
 * O(20) hook dependencies and is impractical to render in jsdom just to
 * assert which shell it picked).
 *
 * ── Why this exists (the iPad back-button bug) ─────────────────────────────
 * The shell renders one of two navigation models:
 *
 *   - "tablet"/"desktop"  → the three-pane layout (renderDesktopLayout):
 *       Sources · Channels · Chat all visible side-by-side. There is NO
 *       back affordance because every parent pane is always on screen, so
 *       "up" is always reachable by just looking left.
 *
 *   - "stack" (mobile)    → the single-pane stacked layout (renderStackLayout):
 *       one frame at a time (sources → servers → channels → chat) with a
 *       SINGLE framework-level back control (canGoBack / handleStackBack)
 *       that pops the stack. This is the ONLY layout that ships a back button.
 *
 * The original iPad branch was `prefersTabletLayout = platform.isIPad` —
 * device-based, unconditional. That forced the three-pane layout on an iPad
 * even when the webview is NARROW (iPadOS Split View / Slide Over, which the
 * app permits via `UIRequiresFullScreen: false`). In a narrow webview the
 * three panes collapse and the user is stranded with no back affordance,
 * because the three-pane layout never renders one.
 *
 * The fix: drive the layout off ACTUAL AVAILABLE WIDTH, not the device type.
 * An iPad wide enough for three panes gets the tablet layout (parent panes
 * visible → no back needed). An iPad narrowed below the multi-pane threshold
 * falls through to the stack layout — which already carries the framework
 * back control — exactly like an iPhone. This makes the back affordance
 * consistent across iPhone and iPad for every level of the stack.
 *
 * The threshold matches Tailwind's default `md` breakpoint (768px), which is
 * the same width at which non-iPad clients flip between the `hidden md:block`
 * desktop shell and the `md:hidden` mobile shell. Keeping the iPad threshold
 * identical means a narrow iPad webview and a narrow browser window behave
 * the same way.
 */

/** Tailwind's default `md` breakpoint. Below this, the shell uses the
 *  single-pane stacked layout (with its framework back control); at or
 *  above it, the multi-pane layout (no back control needed). */
export const TABLET_LAYOUT_MIN_WIDTH = 768;

export type LayoutMode = "tv" | "tablet" | "responsive";

/**
 * Decide whether an iPad should render the multi-pane tablet layout.
 *
 * Returns true ONLY when the device is an iPad AND the webview is wide
 * enough for the three panes to coexist. A narrow iPad (Split View / Slide
 * Over) returns false, so the caller falls through to the responsive
 * (CSS-breakpoint) path, whose `md:hidden` stack layout carries the back
 * affordance.
 *
 * @param isIPad      platform.isIPad
 * @param viewportWidth  current webview width in CSS px (window.innerWidth)
 */
export function shouldUseTabletLayout(
  isIPad: boolean,
  viewportWidth: number,
): boolean {
  if (!isIPad) return false;
  // A non-finite / zero width can show up in jsdom or pre-paint; treat it
  // as "unknown" and prefer the tablet layout for an iPad (the prior
  // unconditional behavior) rather than flashing the phone shell.
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return true;
  return viewportWidth >= TABLET_LAYOUT_MIN_WIDTH;
}

/**
 * Top-level shell selector. TV always wins; otherwise an iPad wide enough
 * gets the tablet layout, and everything else (phones, narrow iPads,
 * desktop browsers) uses the responsive CSS-breakpoint shell.
 */
export function resolveLayoutMode(
  isTV: boolean,
  isIPad: boolean,
  viewportWidth: number,
): LayoutMode {
  if (isTV) return "tv";
  if (shouldUseTabletLayout(isIPad, viewportWidth)) return "tablet";
  return "responsive";
}
