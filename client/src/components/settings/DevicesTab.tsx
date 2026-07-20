/**
 * Settings leaf: **Devices**.
 *
 * The discoverable entry point into multi-device consolidation. Until now
 * `ConsolidatePrompt` (see `../social/consolidate/`) only appeared reactively
 * when a merge proposal was already pending — there was no place a user
 * could go to see this device's identity, the other devices claiming the
 * same owner, or act on a proposal outside of the app-root popup.
 *
 * This tab reuses the owned `useConsolidation` hook verbatim (same IPC
 * surface: `social_devices_list` / `social_consolidate_pending` / accept /
 * reject) rather than re-implementing device/proposal fetching, so behavior
 * stays identical to the reactive prompt. Native-only, like the sibling
 * Peers/Messages leaves — gated on `isTauri` in `SettingsModal`.
 */
import { usePlatform } from "../../hooks/usePlatform";
import { useToastStore } from "../../stores/toast";
import type { ConsolidationProposal, DeviceIdentity } from "../../api/social/types";
import { useConsolidation } from "../social/consolidate/useConsolidation";

/** Short, recognizable device label: explicit label, else truncated peer id. */
function deviceLabel(d: DeviceIdentity): string {
  if (d.label && d.label.trim().length > 0) return d.label;
  if (d.peerId) return `${d.peerId.slice(0, 12)}…`;
  return `${d.deviceId.slice(0, 8)}…`;
}

export function DevicesTab() {
  const { isTauri } = usePlatform();
  const { proposals, devices, loading, error, busyId, accept, reject } =
    useConsolidation();
  const addToast = useToastStore((s) => s.addToast);

  if (!isTauri) {
    return (
      <p className="text-sm text-on-surface-variant italic">
        Device consolidation is available in the desktop app.
      </p>
    );
  }

  const handleAccept = async (proposal: ConsolidationProposal) => {
    const ok = await accept(proposal.id);
    addToast(
      ok ? "Devices consolidated into one identity." : "Could not consolidate devices.",
      ok ? "success" : "error",
    );
  };

  const handleReject = async (proposal: ConsolidationProposal) => {
    const ok = await reject(proposal.id);
    addToast(
      ok ? "Kept devices separate." : "Could not update proposal.",
      ok ? "success" : "error",
    );
  };

  return (
    <div className="flex flex-col gap-6" data-testid="devices-tab">
      <div>
        <h2 className="text-lg font-semibold text-on-surface mb-1">Devices</h2>
        <p className="text-sm text-on-surface-variant">
          This device and any other devices signed in as the same owner.
        </p>
      </div>

      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {/* Pending consolidation proposals — same accept/reject path as the
          reactive app-root prompt (ConsolidatePrompt), surfaced here so a
          user can find and resolve them without waiting for the popup. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
          Pending proposals
        </h3>
        {loading && proposals.length === 0 ? (
          <p className="text-sm text-on-surface-variant italic">Loading…</p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-on-surface-variant italic">
            No pending consolidation proposals.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="devices-proposals">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                className="rounded-lg bg-surface-container-high p-3 flex flex-col gap-2"
                data-testid={`devices-proposal-${proposal.id}`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <DeviceChip label={deviceLabel(proposal.localDevice)} kind="This device" />
                  <span
                    className="material-symbols-outlined text-on-surface-variant text-base leading-none"
                    style={{ fontVariationSettings: '"FILL" 0, "wght" 500' }}
                    aria-hidden
                  >
                    merge
                  </span>
                  <DeviceChip label={deviceLabel(proposal.remoteDevice)} kind="Other device" />
                </div>
                {proposal.conflicts.length > 0 && (
                  <p className="text-xs text-on-surface-variant">
                    {proposal.conflicts.length} conflict(s) will be auto-resolved (most recent
                    value wins; lists merge without losing entries).
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReject(proposal)}
                    disabled={busyId === proposal.id}
                    data-testid={`devices-proposal-reject-${proposal.id}`}
                    className="btn-press px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40"
                  >
                    Keep separate
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAccept(proposal)}
                    disabled={busyId === proposal.id}
                    data-testid={`devices-proposal-accept-${proposal.id}`}
                    className="btn-press px-3 py-1.5 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
                  >
                    {busyId === proposal.id ? "Consolidating…" : "Consolidate"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Known devices — this device plus any already-consolidated remotes. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
          Known devices
        </h3>
        {loading && devices.length === 0 ? (
          <p className="text-sm text-on-surface-variant italic">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-on-surface-variant italic">
            No other devices consolidated into this identity yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="devices-list">
            {devices.map((device) => (
              <li
                key={device.deviceId}
                className="flex items-center justify-between gap-3 py-1.5 px-2 rounded bg-surface-container-high"
                data-testid={`devices-row-${device.deviceId}`}
              >
                <span className="text-sm text-on-surface truncate">{deviceLabel(device)}</span>
                {device.lastSyncAt && (
                  <span
                    className="text-xs text-on-surface-variant whitespace-nowrap"
                    title={`Last sync ${device.lastSyncAt}`}
                  >
                    synced {device.lastSyncAt}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeviceChip({ label, kind }: { label: string; kind: string }) {
  return (
    <span
      className="inline-flex flex-col px-3 py-1.5 rounded-lg bg-surface-container-highest min-w-0"
      title={`${kind}: ${label}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">{kind}</span>
      <span className="text-sm text-on-surface font-mono truncate max-w-[8rem]">{label}</span>
    </span>
  );
}
