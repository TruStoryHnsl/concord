/**
 * Pure helper for deciding whether the first-launch server picker
 * should be shown on mount.
 *
 * The rule in plain English:
 *
 *   Native apps always open hollow. A Tauri desktop or mobile build
 *   with no INS-027 serverConfig in the persisted store renders the
 *   Join/Host picker. Every launch that doesn't yet have a chosen
 *   server comes up as a hollow shell — that's the whole point of a
 *   generic client: every device starts blank and waits for the user
 *   to point it at an instance.
 *
 *   Skip the picker (return `true`) only when:
 *     - The build is desktop web (not Tauri, not mobile). A browser
 *       hitting `https://example.com` implicitly IS on that server —
 *       its origin is its server — so the picker would be redundant.
 *     - A HomeserverConfig is already in the persisted store (user
 *       completed the picker in a previous session).
 *
 * The previous version of this function also respected a legacy
 * `_serverUrl` module-var fallback from Tauri's plugin-store. That
 * slot was written by pre-INS-027 Tauri installs and kept as a
 * migration bridge, but in practice it was a trap: any leaked value
 * in `settings.json` would silently skip the picker forever, which
 * meant the operator's instance hostname could leak into the boot
 * path across sessions and machines. The fallback is gone now —
 * the zustand `serverConfig` store is the sole source of truth, and
 * Tauri's store stops writing `server_url` entirely (see
 * `serverConfig.ts` and `serverUrl.ts` companion edits).
 *
 * Keeping this as a pure function means the test suite can cover
 * every boolean combination without mounting the App tree.
 */

export interface GateInputs {
  /** True when running inside a Tauri webview (desktop OR mobile). */
  isDesktop: boolean;
  /** True when the viewport / UA indicates a mobile device. */
  isMobile: boolean;
  /** True when the INS-027 serverConfig store has a HomeserverConfig. */
  hasNewConfig: boolean;
}

/**
 * Return `true` when the app can proceed straight to the normal shell
 * (meaning: treat the server as "connected"); return `false` when the
 * picker should be shown first.
 */
export function computeInitialServerConnected(inputs: GateInputs): boolean {
  const { isDesktop, isMobile, hasNewConfig } = inputs;

  // A HomeserverConfig already persisted → user completed the picker
  // before. Proceed to the normal shell.
  if (hasNewConfig) return true;

  // Desktop web (non-Tauri, non-mobile) is implicitly "connected" to
  // whatever origin served it — no picker needed.
  if (!isDesktop && !isMobile) return true;

  // Native apps (Tauri desktop, Tauri mobile, mobile web) with no
  // persisted config → always start hollow on the Join/Host picker.
  return false;
}
