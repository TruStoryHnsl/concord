import { useEffect, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import {
  getInstanceUpdateStatus,
  checkInstanceUpdate,
  applyInstanceUpdate,
  type InstanceUpdateStatus,
  type InstanceUpdateCheck,
} from "../../lib/instanceUpdate";

/**
 * Admin-only, user-initiated instance update (single-image docker deploy).
 *
 * Nothing here polls or updates automatically — the admin drives every step:
 * "Check for updates" compares the running image against the registry, and
 * "Update now" pulls the newer image and recreates the container (data is
 * preserved). Rendered only when the server confirms the caller is an instance
 * admin (the status fetch 403s otherwise and the whole section stays hidden).
 */
export function InstanceUpdateSection() {
  const token = useAuthStore((s) => s.accessToken);
  const [status, setStatus] = useState<InstanceUpdateStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [check, setCheck] = useState<InstanceUpdateCheck | null>(null);
  const [busy, setBusy] = useState<"idle" | "checking" | "applying">("idle");
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    getInstanceUpdateStatus(token)
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setHidden(true)); // 403 / not-admin / not available
    return () => {
      alive = false;
    };
  }, [token]);

  if (hidden || !token || !status) return null;

  async function onCheck() {
    setBusy("checking");
    setError(null);
    try {
      setCheck(await checkInstanceUpdate(token!));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy("idle");
    }
  }

  async function onApply() {
    if (
      !window.confirm(
        "Update this instance now? It will briefly restart while the new " +
          "version is applied. Your data (accounts, rooms, media) is preserved.",
      )
    )
      return;
    setBusy("applying");
    setError(null);
    try {
      await applyInstanceUpdate(token!);
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed to start");
    } finally {
      setBusy("idle");
    }
  }

  const canApply = status.update_supported && !applied;

  return (
    <div className="border-t border-outline-variant/15 pt-6">
      <h4 className="text-sm font-medium text-on-surface mb-2">Instance update</h4>

      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-on-surface-variant">Running version</span>
        <span className="text-xs text-on-surface font-mono">{status.version}</span>
      </div>
      {check?.registry_ok && check.latest_digest && (
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-on-surface-variant">Available</span>
          <span className="text-xs text-on-surface font-mono">
            {check.update_available ? "newer image" : "up to date"}
          </span>
        </div>
      )}

      {!status.update_supported && (
        <p className="mt-2 text-xs text-on-surface-variant">
          In-app update isn’t enabled — the Docker socket isn’t mounted into the
          container. Recreate the instance with the deployment compose file to
          enable it.
        </p>
      )}

      {applied ? (
        <p className="mt-3 text-xs text-on-surface">
          Update started. The instance is restarting with the new version —
          this page will reconnect automatically in a moment.
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onCheck}
            disabled={busy !== "idle"}
            className="px-4 py-2 bg-primary/10 hover:bg-primary/15 text-primary text-sm rounded-md transition-colors disabled:opacity-50"
          >
            {busy === "checking" ? "Checking…" : "Check for updates"}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply || busy !== "idle" || (check ? !check.update_available : false)}
            title={
              !status.update_supported
                ? "Docker socket not mounted"
                : check && !check.update_available
                  ? "No newer version available"
                  : "Pull the latest image and recreate the container"
            }
            className="px-4 py-2 bg-primary text-on-primary text-sm rounded-md transition-colors disabled:opacity-40 hover:bg-primary/90"
          >
            {busy === "applying" ? "Starting…" : "Update now"}
          </button>
        </div>
      )}

      {check && !error && (
        <p className="mt-2 text-xs text-on-surface-variant">{check.message}</p>
      )}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </div>
  );
}
