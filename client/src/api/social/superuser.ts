/**
 * API wrapper: **superuser-ux** (OWNED by the superuser-ux branch).
 *
 * Thin wrappers around the `social_owner_*` Tauri commands plus structured
 * error helpers so the UI can branch on the Conflict / NotFound cases the
 * Rust `superuser` module returns. The superuser-ux branch owns this file
 * and may extend it WITHOUT touching the other `social/*` api files. Shared
 * types come from `./types` (read-only).
 *
 * The Rust commands return their `Err` arm as the `String` form of a
 * `SocialError` (`error.into_ipc()`), so `invoke` rejects with that string.
 * The classifier below pattern-matches the stable message fragments those
 * variants emit (see `src-tauri/src/servitude/social/mod.rs`).
 */
import { invoke } from "@tauri-apps/api/core";
import type { OwnerIdentity } from "./types";

/** Read the current owner profile (unclaimed default until first-run). */
export function socialOwnerGet(): Promise<OwnerIdentity> {
  return invoke<OwnerIdentity>("social_owner_get");
}

/**
 * Claim the authoritative owner profile (first-run).
 *
 * Rejects with a string containing "already claimed" when an owner already
 * exists — use {@link isAlreadyClaimedError} to detect that case and route
 * to the owner-controls view instead of surfacing a raw error.
 */
export function socialOwnerClaim(args: {
  displayName: string;
  bio?: string;
  avatarRef?: string;
}): Promise<OwnerIdentity> {
  return invoke<OwnerIdentity>("social_owner_claim", {
    displayName: args.displayName,
    bio: args.bio ?? null,
    avatarRef: args.avatarRef ?? null,
  });
}

/**
 * Update the owner profile. Omitted fields are left unchanged; pass an
 * empty string to clear `bio` / `avatarRef`.
 *
 * Rejects with a string containing "no owner profile has been claimed" when
 * called before first-run — use {@link isNotClaimedError} to detect.
 */
export function socialOwnerUpdate(args: {
  displayName?: string;
  bio?: string;
  avatarRef?: string;
}): Promise<OwnerIdentity> {
  return invoke<OwnerIdentity>("social_owner_update", {
    displayName: args.displayName ?? null,
    bio: args.bio ?? null,
    avatarRef: args.avatarRef ?? null,
  });
}

/** Normalize an unknown thrown value to a string message. */
export function ownerErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True when a `claim` failed because an owner is already claimed. */
export function isAlreadyClaimedError(err: unknown): boolean {
  return ownerErrorMessage(err).toLowerCase().includes("already claimed");
}

/** True when an `update` failed because no owner has been claimed yet. */
export function isNotClaimedError(err: unknown): boolean {
  return ownerErrorMessage(err)
    .toLowerCase()
    .includes("no owner profile has been claimed");
}
