/**
 * API wrapper: **multi-device-consolidation** (OWNED by the consolidation
 * branch).
 *
 * Thin wrappers around the `social_devices_*` / `social_consolidate_*` Tauri
 * commands. Base-branch state: registered, returning NotImplemented until the
 * feature lands. Owned by the consolidation branch; extend WITHOUT touching
 * the other `social/*` api files. Shared types come from `./types`
 * (read-only).
 */
import { invoke } from "@tauri-apps/api/core";
import type { ConsolidationProposal, DeviceIdentity } from "./types";

/** List devices currently claiming the same owner. */
export function socialDevicesList(): Promise<DeviceIdentity[]> {
  return invoke<DeviceIdentity[]>("social_devices_list");
}

/** List pending consolidation proposals awaiting user resolution. */
export function socialConsolidatePending(): Promise<ConsolidationProposal[]> {
  return invoke<ConsolidationProposal[]>("social_consolidate_pending");
}

/** Accept a consolidation proposal (merge the remote device's state). */
export function socialConsolidateAccept(proposalId: string): Promise<void> {
  return invoke<void>("social_consolidate_accept", { proposalId });
}

/** Reject a consolidation proposal. */
export function socialConsolidateReject(proposalId: string): Promise<void> {
  return invoke<void>("social_consolidate_reject", { proposalId });
}
