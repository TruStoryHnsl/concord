const BOOT_SPLASH_ID = "boot-splash";
const BOOT_SPLASH_STATUS_ID = "boot-splash-status";

export function getBootSplashWaitingLabel(
  host = typeof window !== "undefined" ? window.location.host : "host",
): string {
  return `Waiting for ${host}`;
}

function getBootSplash(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(BOOT_SPLASH_ID);
}

function getBootSplashStatus(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(BOOT_SPLASH_STATUS_ID);
}

export function showBootSplash(statusText = getBootSplashWaitingLabel()): void {
  const splash = getBootSplash();
  if (!splash) return;
  const status = getBootSplashStatus();
  if (status) status.textContent = statusText;
  splash.setAttribute("data-state", "visible");
}

/**
 * Hand the splash off from the pre-React `#boot-splash` layer to the
 * React `<LaunchAnimation/>` component — without ever letting both
 * layers render the mark simultaneously.
 *
 * The boot splash exists to cover the first-paint gap between the
 * raw HTML and React hydration. Once React has mounted its own
 * LaunchAnimation layer, the boot layer is redundant and actively
 * harmful — two SVGs rasterising the same geometry on different
 * layers diverge by a subpixel during opacity transitions, which
 * reads as a ghost second mark. (We've shipped that bug before,
 * most recently in commits 5b239d6 / a8f23e5.)
 *
 * The previous implementation used a 320ms CSS opacity fade on the
 * boot layer, but that creates a crossfade window where both layers
 * are visible with non-zero opacity. Instrumented Playwright runs
 * measured 12 / 100 samples (≈300ms) in that double-layer window.
 *
 * Current implementation: retire the boot layer atomically on the
 * same frame React commits its LaunchAnimation tree. Two toggles:
 *   1. `data-state="handoff"` triggers the CSS rule that zeros
 *      opacity (kept for back-compat / any external observers).
 *   2. `.boot-splash-retired` flips `display: none` immediately,
 *      removing the layer from the render tree entirely.
 * React's LaunchAnimation fades itself out on its own schedule
 * afterwards; the boot layer plays no part in that fade.
 */
export function handoffBootSplash(): void {
  const splash = getBootSplash();
  if (!splash) return;
  splash.setAttribute("data-state", "handoff");
  splash.classList.add("boot-splash-retired");
}

/**
 * Back-compat export. Historically the boot splash faded out across
 * this interval before being removed from the tree. The fade was
 * dropped in favour of an atomic retire (see `handoffBootSplash`)
 * so this is now an upper bound on how long any external code
 * should wait for the transition to settle — in practice the
 * display:none is synchronous.
 */
export const BOOT_SPLASH_FADE_MS = 0;
