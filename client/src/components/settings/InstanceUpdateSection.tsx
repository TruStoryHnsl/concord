import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import {
  getInstanceUpdateStatus,
  checkInstanceUpdate,
  applyInstanceUpdate,
  startFullStackUpdate,
  getFullStackUpdateStatus,
  FULLSTACK_TERMINAL_PHASES,
  type InstanceUpdateStatus,
  type InstanceUpdateCheck,
  type FullStackUpdateStatus,
} from "../../lib/instanceUpdate";

const FULLSTACK_PHASE_LABEL: Record<string, string> = {
  starting: "Starting…",
  snapshot: "Recording rollback point…",
  pulling: "Pulling images…",
  building: "Rebuilding all services…",
  recreating: "Recreating containers…",
  health_check: "Waiting for services to become healthy…",
  success: "Update complete — all services healthy.",
  rolling_back: "Health check failed — rolling back…",
  rolled_back: "Update failed; rolled back to the previous version.",
  rollback_failed:
    "Update failed AND rollback did not restore health — operator intervention required.",
  failed: "Update failed to complete.",
  idle: "No update running.",
};

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

  // Full-stack (rebuild + relaunch ALL) job state.
  const [fsStatus, setFsStatus] = useState<FullStackUpdateStatus | null>(null);
  const [fsStarting, setFsStarting] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const fsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Poll full-stack status while a job is in a non-terminal phase.
  useEffect(() => {
    if (!token || !fsStatus) return;
    if (FULLSTACK_TERMINAL_PHASES.includes(fsStatus.phase)) {
      if (fsPollRef.current) {
        clearInterval(fsPollRef.current);
        fsPollRef.current = null;
      }
      return;
    }
    if (fsPollRef.current) return; // already polling
    fsPollRef.current = setInterval(() => {
      getFullStackUpdateStatus(token)
        .then(setFsStatus)
        .catch(() => {
          // concord-api is likely mid-recreate; keep polling — it comes back.
        });
    }, 4000);
    return () => {
      if (fsPollRef.current) {
        clearInterval(fsPollRef.current);
        fsPollRef.current = null;
      }
    };
  }, [token, fsStatus]);

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

  async function onFullStackUpdate() {
    if (
      !window.confirm(
        "Rebuild AND relaunch the ENTIRE stack now?\n\n" +
          "This pulls + rebuilds every image and recreates every container " +
          "(Matrix server, API, web, voice, TURN). The instance will be " +
          "briefly unavailable during the relaunch. If any service fails its " +
          "health check, the update automatically rolls back to the current " +
          "version. Your data (accounts, rooms, media) is preserved.\n\n" +
          "Proceed?",
      )
    )
      return;
    setFsStarting(true);
    setFsError(null);
    try {
      const res = await startFullStackUpdate(token!);
      // Seed a starting status so the poller kicks in immediately.
      setFsStatus({
        phase: "starting",
        ok: null,
        message: res.message,
        job_id: res.job_id,
      });
    } catch (e) {
      setFsError(e instanceof Error ? e.message : "Failed to start full update");
    } finally {
      setFsStarting(false);
    }
  }

  const fsInProgress =
    !!fsStatus && !FULLSTACK_TERMINAL_PHASES.includes(fsStatus.phase);

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

      {/* Full rebuild & relaunch (multi-container compose deploy). Rebuilds AND
          relaunches ALL containers/images as a sanity check — never selective. */}
      {status.update_supported && (
        <div className="mt-5 border-t border-outline-variant/10 pt-4">
          <h5 className="text-xs font-medium text-on-surface mb-1">
            Full rebuild &amp; relaunch
          </h5>
          <p className="text-[11px] text-on-surface-variant mb-3">
            Rebuilds and recreates <strong>every</strong> container and image
            (not just the ones that changed), then verifies each service is
            healthy and rolls back automatically if any fails. Use this to bring
            the whole deployment onto the latest build as a sanity check.
          </p>

          <button
            type="button"
            onClick={onFullStackUpdate}
            disabled={fsStarting || fsInProgress}
            className="px-4 py-2 bg-error/10 hover:bg-error/15 text-error text-sm rounded-md transition-colors disabled:opacity-50"
          >
            {fsStarting
              ? "Starting…"
              : fsInProgress
                ? "Update in progress…"
                : "Rebuild & relaunch all"}
          </button>

          {fsStatus && fsStatus.phase !== "idle" && (
            <div className="mt-3">
              <p
                className={
                  "text-xs " +
                  (fsStatus.ok === true
                    ? "text-on-surface"
                    : fsStatus.ok === false
                      ? "text-error"
                      : "text-on-surface-variant")
                }
              >
                {FULLSTACK_PHASE_LABEL[fsStatus.phase] || fsStatus.message}
              </p>
              {fsStatus.message &&
                fsStatus.message !==
                  (FULLSTACK_PHASE_LABEL[fsStatus.phase] || "") && (
                  <p className="mt-1 text-[11px] text-on-surface-variant">
                    {fsStatus.message}
                  </p>
                )}
            </div>
          )}
          {fsError && <p className="mt-2 text-xs text-error">{fsError}</p>}
        </div>
      )}
    </div>
  );
}
