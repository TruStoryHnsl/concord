/**
 * NUI-F24 — LAN auto-pair opt-in API wrapper.
 *
 * Thin wrappers around the `get_lan_auto_pair` / `set_lan_auto_pair` Tauri
 * commands (`src-tauri/src/commands/server.rs`). Backed by
 * `ServitudeConfig.lan_auto_pair` in the shared `settings.json`; default
 * OFF, and a settings file predating the field reads OFF — an upgrade can
 * never silently enable ambient pairing.
 *
 * The toggle takes effect at the NEXT mDNS broadcast with no node restart:
 * the swarm-event mirror re-reads the flag per discovered peer.
 *
 * Native-only: the web build runs no mDNS discovery, so the getter reports
 * `false` and the setter rejects.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./servitude";

/** Whether ambient reciprocal LAN auto-pairing is enabled. */
export async function getLanAutoPair(): Promise<boolean> {
  if (!isTauri()) return false;
  return await invoke<boolean>("get_lan_auto_pair");
}

/** Persist the LAN auto-pair opt-in. */
export async function setLanAutoPair(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    throw new Error(
      "setLanAutoPair: the web build runs no LAN discovery to auto-pair from.",
    );
  }
  await invoke<void>("set_lan_auto_pair", { enabled });
}
