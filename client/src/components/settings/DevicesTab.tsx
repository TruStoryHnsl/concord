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
import { useCallback, useEffect, useState } from "react";

import { usePlatform } from "../../hooks/usePlatform";
import { useToastStore } from "../../stores/toast";
import { porchLinkPersonalDevice } from "../../api/porch";
import { socialConsolidateAttempt } from "../../api/social/consolidate";
import {
  supertrustLinkCandidates,
  supertrustRespond,
  type SupertrustLinkCandidate,
} from "../../api/supertrust";
import type { ConsolidationProposal, DeviceIdentity } from "../../api/social/types";
import { useConsolidation } from "../social/consolidate/useConsolidation";
import { PersonalDevices } from "../porch/PersonalDevices";

/** Short, recognizable device label: explicit label, else truncated peer id. */
function deviceLabel(d: DeviceIdentity): string {
  if (d.label && d.label.trim().length > 0) return d.label;
  if (d.peerId) return `${d.peerId.slice(0, 12)}…`;
  return `${d.deviceId.slice(0, 8)}…`;
}

export function DevicesTab() {
  const { isTauri } = usePlatform();
  const { proposals, devices, loading, error, busyId, accept, reject, refresh } =
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

      {/* NUI-F35 — supertrust device-link escalation. The only legitimate
          way to pass the peer_is_own_device gate consolidation routes on. */}
      <LinkDevicesSection onEscalated={() => void refresh()} />

      {/* Phase F — already-linked personal devices: per-row sync/unlink +
          the 60s background auto-sync loop. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
          Linked personal devices
        </h3>
        <PersonalDevices />
      </section>
    </div>
  );
}

/** Pending confirmation state for the escalation section — which control
 *  was pressed, for which candidate. */
interface LinkConfirm {
  kind: "allow" | "link";
  candidate: SupertrustLinkCandidate;
}

/** Short, recognizable candidate label: registry label, else truncated id. */
function candidateLabel(c: SupertrustLinkCandidate): string {
  if (c.label && c.label.trim().length > 0) return c.label;
  return `${c.peerId.slice(0, 12)}…`;
}

/**
 * NUI-F35 — "Link another of your devices".
 *
 * TWO controls, one per machine, because the handshake is deliberately
 * halved: "Allow linking" arms the responder's one-shot consent on the
 * device being asked; "Link as my device" runs the initiator's signed
 * handshake on the device asking. Neither fires both, and nothing arms
 * consent implicitly — remove either half and a single machine could
 * unilaterally put itself on another machine's superuser channel.
 *
 * Copy discipline (from the native-shell F35 fix, 8e1c891): what the user
 * grants here is NOT a trust level for a peer. It moves the machine to a
 * different channel class — "you are saying that machine IS YOU" — so the
 * copy says that in as many words and never names a trust tier. The
 * confirmation carries the peer's DEVICE fingerprint (NUI-F29): the device
 * key is inlined in the peer id, so the remote machine renders the
 * identical string for itself, while the owner fingerprint is shared by
 * sibling installs by construction and could not tell two of the user's
 * machines apart.
 */
function LinkDevicesSection({ onEscalated }: { onEscalated: () => void }) {
  const [candidates, setCandidates] = useState<SupertrustLinkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<LinkConfirm | null>(null);
  const [busyPeerId, setBusyPeerId] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await supertrustLinkCandidates();
      setCandidates(Array.isArray(list) ? list : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAllow = async (candidate: SupertrustLinkCandidate) => {
    setConfirm(null);
    setBusyPeerId(candidate.peerId);
    try {
      await supertrustRespond(candidate.peerId, true);
      // The wording deliberately says what has and has NOT happened yet —
      // the user just pressed a button whose visible effect is nothing at
      // all until the other machine acts.
      addToast(
        `Waiting for ${candidateLabel(candidate)} to ask. Nothing has changed yet — ` +
          "this device will accept ONE link request from it, and only if it arrives " +
          "signed by the key you paired with. Go to that device now and press " +
          "“Link as my device”. If nothing happens, press Allow here again.",
        "success",
      );
    } catch (e) {
      addToast(
        `Could not arm linking consent: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setBusyPeerId(null);
    }
  };

  const handleLink = async (candidate: SupertrustLinkCandidate) => {
    setConfirm(null);
    setBusyPeerId(candidate.peerId);
    const label = candidateLabel(candidate);
    try {
      const outcome = await porchLinkPersonalDevice(
        candidate.peerId,
        candidate.label,
      );
      if (!outcome.linked_as_device) {
        // Both flags are set together by commit_escalation and a partial
        // result is not a state it can return — but reporting the field we
        // were handed, rather than a sentence we assumed, is the house rule
        // for anything a user acts on.
        addToast(
          `${label} answered, but this device did not record a link. Nothing changed here.`,
          "error",
        );
        return;
      }
      addToast(
        `${label} is now one of your devices. Both machines signed for it.`,
        "success",
      );
      // Post-escalation consolidation kick — the standing trigger is
      // DialSuccess, and escalating an already-connected peer raises no
      // new connection event. A trigger, not a bypass: the Rust side
      // re-checks the own-device gate itself.
      try {
        const result = await socialConsolidateAttempt(candidate.peerId);
        if (result === "enqueued" || result === "alreadyPending") {
          addToast(
            "The two devices exchanged a consolidation proposal — it appears above, " +
              "under “Pending proposals”, and nothing is merged until you approve it.",
            "success",
          );
        }
      } catch (e) {
        addToast(
          "Linked, but the consolidation exchange could not start: " +
            `${e instanceof Error ? e.message : String(e)}. It will retry on the ` +
            "next connection to that device.",
          "error",
        );
      }
      await reload();
      onEscalated();
    } catch (e) {
      // The two ordinary causes, said out loud — "handshake failed" sends
      // the user looking in the wrong place (NUI-F30).
      addToast(
        `Could not link ${label}: ${e instanceof Error ? e.message : String(e)}. ` +
          "Nothing changed on either device. The two usual causes are that the other " +
          "device has not pressed “Allow linking” (its consent is one-shot and is used " +
          "up by one attempt), or that the two were paired over LAN discovery rather " +
          "than by exchanging peer cards — a discovery-paired peer stores the wrong " +
          "key for this handshake and cannot complete it.",
        "error",
      );
    } finally {
      setBusyPeerId(null);
    }
  };

  return (
    <section className="flex flex-col gap-2" data-testid="devices-link-section">
      <h3 className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
        Link another of your devices
      </h3>
      <p className="text-sm text-on-surface-variant">
        Linking says that machine <span className="font-semibold">is you</span>{" "}
        — it becomes one of your devices, they sync, and their identities merge
        after your confirmation. This is not a trust setting for other people.
        Linking takes one press on <em>each</em> machine: “Allow linking” on
        the device being asked, then “Link as my device” on the device asking.
      </p>

      {loadError && (
        <p className="text-sm text-error" role="alert">
          {loadError}
        </p>
      )}

      {loading && candidates.length === 0 ? (
        <p className="text-sm text-on-surface-variant italic">Loading…</p>
      ) : candidates.length === 0 ? (
        <p
          className="text-sm text-on-surface-variant italic"
          data-testid="devices-link-empty"
        >
          No paired peers available to link. Pair the other device first — by
          exchanging peer cards, so it carries the key this handshake needs.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="devices-link-candidates">
          {candidates.map((candidate) => (
            <li
              key={candidate.peerId}
              className="rounded-lg bg-surface-container-high p-3 flex flex-col gap-2"
              data-testid={`devices-link-candidate-${candidate.peerId}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-on-surface truncate">
                    {candidateLabel(candidate)}
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono truncate">
                    {candidate.peerId}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "allow", candidate })}
                    disabled={!candidate.cardPaired || busyPeerId === candidate.peerId}
                    data-testid={`devices-link-allow-${candidate.peerId}`}
                    className="btn-press px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40"
                  >
                    Allow linking
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "link", candidate })}
                    disabled={!candidate.cardPaired || busyPeerId === candidate.peerId}
                    data-testid={`devices-link-link-${candidate.peerId}`}
                    className="btn-press px-3 py-1.5 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
                  >
                    {busyPeerId === candidate.peerId ? "Linking…" : "Link as my device"}
                  </button>
                </div>
              </div>
              {!candidate.cardPaired && (
                // NUI-F30 — discovery pairing stores the peer's DEVICE key,
                // while the link handshake is signed by the OWNER key; the
                // far side refuses it fail-closed. Said out loud here so the
                // disabled controls don't read as a bug.
                <p
                  className="text-xs text-on-surface-variant italic"
                  data-testid={`devices-link-discovery-note-${candidate.peerId}`}
                >
                  Paired via network discovery — it can’t complete the link
                  handshake. Re-pair by exchanging peer cards to link it.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <div
          className="rounded-lg border border-outline-variant/40 bg-surface-container-highest p-3 flex flex-col gap-2"
          data-testid="devices-link-confirm"
        >
          <p className="text-sm text-on-surface">
            You are saying that machine <span className="font-semibold">IS YOU</span>.
          </p>
          {confirm.kind === "link" ? (
            <p className="text-sm text-on-surface-variant">
              {candidateLabel(confirm.candidate)} will become one of your
              devices: it joins your device set, your devices sync, and a merge
              proposal follows for your approval. This only works if that
              machine pressed “Allow linking” first.
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant">
              This device will accept ONE link request from{" "}
              {candidateLabel(confirm.candidate)} — only if it arrives signed by
              the key you paired with. Nothing changes until that machine
              presses “Link as my device”.
            </p>
          )}
          {confirm.candidate.deviceFingerprint ? (
            <div className="text-sm">
              <span className="text-on-surface-variant">
                Before continuing, compare this device fingerprint with the one
                that machine shows for itself under Settings → Connections →
                “This device”:
              </span>
              <div
                className="font-mono text-on-surface mt-1"
                data-testid="devices-link-confirm-fingerprint"
              >
                {confirm.candidate.deviceFingerprint}
              </div>
            </div>
          ) : (
            <p
              className="text-sm text-on-surface-variant italic"
              data-testid="devices-link-confirm-no-fingerprint"
            >
              No fingerprint to compare — this peer’s device key could not be
              read from its id. Only continue if you are certain which machine
              this is.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              data-testid="devices-link-confirm-cancel"
              className="btn-press px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                confirm.kind === "link"
                  ? void handleLink(confirm.candidate)
                  : void handleAllow(confirm.candidate)
              }
              data-testid="devices-link-confirm-proceed"
              className="btn-press px-3 py-1.5 primary-glow hover:brightness-110 text-on-surface text-sm rounded-md transition-colors"
            >
              {confirm.kind === "link" ? "It is me — link it" : "Allow one request"}
            </button>
          </div>
        </div>
      )}
    </section>
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
