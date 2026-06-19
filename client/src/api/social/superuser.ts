/**
 * API wrapper: **superuser-ux** (OWNED by the superuser-ux branch).
 *
 * Thin wrappers around the `social_owner_*` Tauri commands. Base-branch
 * state: the commands are registered but return NotImplemented until the
 * feature lands. The superuser-ux branch owns this file and may extend it
 * WITHOUT touching the other `social/*` api files. Shared types come from
 * `./types` (read-only).
 */
import { invoke } from "@tauri-apps/api/core";
import type { OwnerIdentity } from "./types";

/** Read the current owner profile (unclaimed default until first-run). */
export function socialOwnerGet(): Promise<OwnerIdentity> {
  return invoke<OwnerIdentity>("social_owner_get");
}

/** Claim the authoritative owner profile (first-run). */
export function socialOwnerClaim(displayName: string): Promise<OwnerIdentity> {
  return invoke<OwnerIdentity>("social_owner_claim", { displayName });
}

/** Update the owner profile. */
export function socialOwnerUpdate(args: {
  displayName?: string;
  bio?: string;
  avatarRef?: string;
}): Promise<OwnerIdentity> {
  return invoke<OwnerIdentity>("social_owner_update", args);
}
