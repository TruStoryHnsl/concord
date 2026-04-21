import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import {
  userDiscordStatus,
  userDiscordLogin,
  userDiscordLogout,
  type UserDiscordStatus,
} from "../../api/bridges";
import { DiscordTosModal } from "./DiscordTosModal";

/**
 * Per-user Connections tab (PR3/5 of the user-scoped bridge redesign).
 *
 * Lives under the user's own profile settings — NOT the admin section.
 * Any authenticated user can connect or disconnect their personal
 * Discord account here; admins have no equivalent "manage someone
 * else's connection" path.
 *
 * Flow:
 *   1. User clicks "Connect Discord".
 *   2. ToS modal (token-at-rest caveat for web users; closes when the
 *      native Tauri client ships).
 *   3. On accept, frontend calls POST /users/me/discord/login.
 *   4. Backend creates a DM between the user and @discordbot and posts
 *      "login". The bridge bot replies in that DM with a QR code the
 *      user scans from their phone's Discord app.
 *   5. Frontend shows "Check your DM with Discord Bot for the QR code"
 *      and polls /users/me/discord until connected goes true.
 *
 * PR3 intentionally keeps the status endpoint stub (always false); the
 * real detection lands once we wire mautrix-discord's provisioning API
 * per-user. Polling is already in place so no frontend change needed
 * when that lands.
 */
export function UserConnectionsTab() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [status, setStatus] = useState<UserDiscordStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTos, setShowTos] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [lastLoginRoomId, setLastLoginRoomId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Mirror the existing ToS-persistence convention from BridgesTab/UserModeSection.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("concord_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state?.discord_bridge_tos_accepted_at) {
          setTosAccepted(true);
        }
      }
    } catch {
      // Ignore — fresh device, nothing to restore.
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const s = await userDiscordStatus(accessToken);
      if (!mountedRef.current) return;
      setStatus(s);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    // Poll every 5s while the tab is mounted. Cheap — a GET with no
    // side effects. Picks up completion of the QR flow even if the
    // user stays on this tab the whole time.
    const interval = window.setInterval(refresh, 5000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  // Tracks whether the user clicked Connect before ToS was accepted.
  // If they accept in the modal, we auto-run the connect flow so they
  // don't have to click a second time.
  const [pendingConnect, setPendingConnect] = useState(false);

  // DiscordTosModal owns the localStorage write — we just re-read it on
  // close to see if the user actually checked the box and accepted.
  const handleTosClosed = useCallback(() => {
    setShowTos(false);
    try {
      const raw = localStorage.getItem("concord_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state?.discord_bridge_tos_accepted_at) {
          setTosAccepted(true);
          // If user hit Connect first and THEN accepted, start the
          // login flow now without requiring a second click.
          if (pendingConnect) {
            setPendingConnect(false);
            // Defer to next tick so state updates flush first.
            window.setTimeout(() => {
              // Trigger the login flow via a direct API call (can't
              // call handleConnect here — it depends on tosAccepted
              // state that hasn't propagated yet).
              if (accessToken) {
                userDiscordLogin(accessToken).then(
                  (result) => {
                    if (!mountedRef.current) return;
                    setLastLoginRoomId(result.room_id);
                    refresh();
                  },
                  (err) => {
                    if (!mountedRef.current) return;
                    setError(err instanceof Error ? err.message : String(err));
                  },
                );
              }
            }, 0);
          }
        } else {
          setPendingConnect(false);
        }
      }
    } catch {
      setPendingConnect(false);
    }
  }, [pendingConnect, accessToken, refresh]);

  const handleConnect = useCallback(async () => {
    if (!accessToken) return;
    if (!tosAccepted) {
      // Queue the connect so it runs automatically after the user
      // accepts the ToS in the modal.
      setPendingConnect(true);
      setShowTos(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await userDiscordLogin(accessToken);
      if (!mountedRef.current) return;
      setLastLoginRoomId(result.room_id);
      // Refresh after a short delay to pick up any early state change.
      window.setTimeout(refresh, 500);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [accessToken, tosAccepted, refresh]);

  const handleDisconnect = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await userDiscordLogout(accessToken);
      if (!mountedRef.current) return;
      setLastLoginRoomId(null);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [accessToken, refresh]);

  if (!accessToken) {
    return (
      <div className="space-y-4" data-testid="user-connections-tab">
        <h3 className="text-xl font-semibold text-on-surface">Connections</h3>
        <p className="text-sm text-on-surface-variant">
          Sign in to manage your connected accounts.
        </p>
      </div>
    );
  }

  const connected = status?.connected ?? false;

  return (
    <div className="space-y-6" data-testid="user-connections-tab">
      <div>
        <h3 className="text-xl font-semibold text-on-surface">Connections</h3>
        <p className="text-sm text-on-surface-variant mt-1">
          Link external accounts to Concord. Each connection is personal to
          you — other users and admins can't see or act on your connections.
        </p>
      </div>

      {/* Discord */}
      <div className="border border-outline-variant/20 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-low/60">
          <span className="text-xl">🎮</span>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-on-surface">Discord</h4>
            <p className="text-xs text-on-surface-variant">
              Connect your personal Discord account. Your guilds appear as
              Concord rooms scoped to you.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {status === null ? (
              <span className="text-xs text-on-surface-variant/50">Loading…</span>
            ) : connected ? (
              <>
                <span className="inline-flex items-center gap-1 text-xs text-green-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Connected
                </span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={busy}
                  data-testid="user-discord-disconnect-btn"
                  className="px-3 py-1.5 bg-error/10 hover:bg-error/15 text-error text-xs rounded-md transition-colors disabled:opacity-40 min-h-[32px]"
                >
                  {busy ? "…" : "Disconnect"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy}
                data-testid="user-discord-connect-btn"
                className="px-3 py-1.5 bg-primary/10 hover:bg-primary/15 text-primary text-xs rounded-md transition-colors disabled:opacity-40 min-h-[32px]"
              >
                {busy ? "…" : "Connect with Discord"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-error/10 border-t border-error/20">
            <p className="text-xs text-error" data-testid="user-discord-error">
              {error}
            </p>
          </div>
        )}

        {lastLoginRoomId && !connected && (
          <div className="px-4 py-3 border-t border-outline-variant/10 bg-primary/5">
            <p className="text-xs text-on-surface">
              Login started. Open your DM with <code
                className="bg-surface-container-highest px-1 py-0.5 rounded"
              >@discordbot</code> in Concord to scan the QR code with your
              Discord phone app. This page will update automatically once
              the handshake completes.
            </p>
          </div>
        )}

        {/* Connection context for a connected user */}
        {connected && (
          <div className="px-4 py-3 border-t border-outline-variant/10 bg-surface-container-lowest/40">
            <p className="text-xs text-on-surface-variant">
              Signed in as{" "}
              <code className="bg-surface-container-highest px-1 py-0.5 rounded">
                {status?.mxid}
              </code>
              . Disconnect to revoke access and purge your session from the
              bridge.
            </p>
          </div>
        )}
      </div>

      {/* Future connections (Slack, Telegram, ...) go here as additional
          cards with the same shape. */}

      {showTos && (
        <DiscordTosModal onClose={handleTosClosed} />
      )}
    </div>
  );
}
