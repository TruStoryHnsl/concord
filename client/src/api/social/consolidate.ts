/**
 * API wrapper: **multi-device-consolidation** (OWNED by the consolidation
 * branch).
 *
 * Thin wrappers around the `social_devices_*` / `social_consolidate_*` Tauri
 * commands. The Rust side persists the consolidation store under the
 * install's app-local data dir and resolves merge conflicts via last-write-
 * wins; these wrappers are the renderer's typed door to that surface. Owned
 * by the consolidation branch; extend WITHOUT touching the other `social/*`
 * api files. Shared types come from `./types` (read-only).
 *
 * Web fallback: the consolidation surface is native-only (it depends on the
 * filesystem-backed store). On the web build there are no other devices to
 * consolidate, so the list/pending calls resolve to empty arrays and the
 * mutating calls reject with a clear "native only" error rather than throwing
 * an opaque `invoke` failure.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../servitude";
import type { ConsolidationProposal, DeviceIdentity } from "./types";

/** Raised by the mutating calls on the web build, where there is no store. */
export class ConsolidationUnavailableError extends Error {
  constructor() {
    super("Multi-device consolidation is only available in the native app.");
    this.name = "ConsolidationUnavailableError";
  }
}

/** List devices currently claiming the same owner. Empty on web. */
export function socialDevicesList(): Promise<DeviceIdentity[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<DeviceIdentity[]>("social_devices_list");
}

/** List pending consolidation proposals awaiting user resolution. Empty on web. */
export function socialConsolidatePending(): Promise<ConsolidationProposal[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<ConsolidationProposal[]>("social_consolidate_pending");
}

/**
 * Accept a consolidation proposal (merge the remote device's state into the
 * local unified identity). Resolves with the accepted proposal so the caller
 * can confirm exactly what was consolidated.
 */
export function socialConsolidateAccept(
  proposalId: string,
): Promise<ConsolidationProposal> {
  if (!isTauri()) return Promise.reject(new ConsolidationUnavailableError());
  return invoke<ConsolidationProposal>("social_consolidate_accept", {
    proposalId,
  });
}

/** Reject a consolidation proposal (keep the devices' state separate). */
export function socialConsolidateReject(proposalId: string): Promise<void> {
  if (!isTauri()) return Promise.reject(new ConsolidationUnavailableError());
  return invoke<void>("social_consolidate_reject", { proposalId });
}
