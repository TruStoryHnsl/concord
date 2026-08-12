/**
 * Component home: **multi-device-consolidation** (OWNED by the consolidation
 * branch).
 *
 * Merge-prompt UX surfaced when multiple devices claim the same owner. When
 * the native store has one or more pending [`ConsolidationProposal`]s, this
 * renders a modal for each (one at a time) showing:
 *
 *   - the local + remote device identities being consolidated;
 *   - the list of auto-resolved conflicts the merge will apply
 *     (empty ⇒ a clean merge, shown as "No conflicts — clean merge");
 *   - Consolidate (accept) / Keep separate (reject) actions.
 *
 * Accepting commits the merge in the Rust layer (last-write-wins, dedupe,
 * multiaddr union) and records the remote as a consolidated device.
 * Rejecting keeps the two devices' state separate. The component renders
 * nothing when there are no pending proposals, so it's safe to mount at the
 * app root.
 *
 * Owns everything under `client/src/components/social/consolidate/`.
 */
import { useToastStore } from "../../../stores/toast";
import type { ConsolidationProposal, DeviceIdentity } from "../../../api/social/types";
import { useConsolidation } from "./useConsolidation";

/** Short, recognizable device label: explicit label, else truncated peer id. */
function deviceLabel(d: DeviceIdentity): string {
  if (d.label && d.label.trim().length > 0) return d.label;
  if (d.peerId) return `${d.peerId.slice(0, 12)}…`;
  return `${d.deviceId.slice(0, 8)}…`;
}

export function ConsolidatePrompt() {
  const { proposals, loading, error, busyId, accept, reject } = useConsolidation();
  const addToast = useToastStore((s) => s.addToast);

  // Nothing to do until at least one proposal is pending. Loading/erroring
  // silently — this is a passive, app-root prompt, not a primary surface.
  if (loading || proposals.length === 0) return null;

  // Surface one proposal at a time. After the user resolves it the hook
  // removes it from the list and the next one (if any) renders.
  const proposal = proposals[0];
  const remaining = proposals.length - 1;

  const handleAccept = async () => {
    const ok = await accept(proposal.id);
    addToast(
      ok ? "Devices consolidated into one identity." : "Could not consolidate devices.",
      ok ? "success" : "error",
    );
  };

  const handleReject = async () => {
    const ok = await reject(proposal.id);
    if (ok) {
      addToast("Kept devices separate.", "success");
    } else {
      addToast("Could not update proposal.", "error");
    }
  };

  return (
    <ConsolidateModal
      proposal={proposal}
      remaining={remaining}
      busy={busyId === proposal.id}
      error={error}
      onAccept={() => void handleAccept()}
      onReject={() => void handleReject()}
    />
  );
}

function ConsolidateModal({
  proposal,
  remaining,
  busy,
  error,
  onAccept,
  onReject,
}: {
  proposal: ConsolidationProposal;
  remaining: number;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { conflicts } = proposal;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
      data-testid="consolidate-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Consolidate devices"
    >
      <div className="bg-surface-container rounded-xl border border-outline-variant/15 shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/15">
          <h2 className="text-lg font-semibold text-on-surface">
            Consolidate this identity
          </h2>
          {remaining > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant"
              title={`${remaining} more device(s) waiting to consolidate`}
            >
              +{remaining} more
            </span>
          )}
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-on-surface-variant">
            Another device is signed in as the same owner. Consolidate it to
            merge its profile, peers, and conversations into one unified
            identity on this device.
          </p>

          {/* Device pair */}
          <div className="flex items-center gap-2 text-sm">
            <DeviceChip label={deviceLabel(proposal.localDevice)} kind="This device" />
            <span
              className="material-symbols-outlined text-on-surface-variant text-base leading-none"
              style={{ fontVariationSettings: '"FILL" 0, "wght" 500' }}
            >
              merge
            </span>
            <DeviceChip label={deviceLabel(proposal.remoteDevice)} kind="Other device" />
          </div>

          {/* Conflicts */}
          <div>
            <h3 className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">
              {conflicts.length === 0
                ? "Merge preview"
                : `Conflicts resolved (${conflicts.length})`}
            </h3>
            {conflicts.length === 0 ? (
              <p className="text-sm text-on-surface-variant italic">
                No conflicts — clean merge.
              </p>
            ) : (
              <ul
                className="space-y-1 max-h-40 overflow-y-auto"
                data-testid="consolidate-conflicts"
              >
                {conflicts.map((c, i) => (
                  <li
                    key={i}
                    className="text-sm text-on-surface flex items-start gap-2"
                  >
                    <span
                      className="material-symbols-outlined text-amber-500 text-base leading-none mt-0.5"
                      style={{ fontVariationSettings: '"FILL" 1, "wght" 500' }}
                      aria-hidden
                    >
                      warning
                    </span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
            {conflicts.length > 0 && (
              <p className="text-xs text-on-surface-variant mt-1">
                These are resolved automatically: the most recent value wins,
                and lists are merged without losing entries.
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              data-testid="consolidate-reject"
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40"
            >
              Keep separate
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              data-testid="consolidate-accept"
              className="px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
            >
              {busy ? "Consolidating…" : "Consolidate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceChip({ label, kind }: { label: string; kind: string }) {
  return (
    <span
      className="inline-flex flex-col px-3 py-1.5 rounded-lg bg-surface-container-high min-w-0"
      title={`${kind}: ${label}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">
        {kind}
      </span>
      <span className="text-sm text-on-surface font-mono truncate max-w-[8rem]">
        {label}
      </span>
    </span>
  );
}
