/**
 * Reticulum interface config (R6).
 *
 * Manage the interfaces written into Concord's ISOLATED rnsd config (never
 * `~/.reticulum`). Mirrors crosstalk's interface taxonomy: a remote hub
 * (`TCPClientInterface`), a local listener (`TCPServerInterface`), LAN
 * multicast (`AutoInterface`), or a LoRa radio (`RNodeInterface`, opt-in).
 *
 * Native-only: the rnsd config lives in the desktop/mobile swarm. On web every
 * call here is inert — `listReticulumInterfaces()` returns `[]` and mutations
 * are no-ops — so call sites don't have to branch on platform.
 *
 * The interface object is a flat `{ name, enabled, type, …type-fields }` — the
 * exact shape the Rust `ReticulumInterface` serializes to, so it round-trips
 * through the `reticulum_interface_*` commands without a translation layer.
 */

import { isTauri } from "./servitude";

/** The interface classes Concord's UI can add. Matches the RNS class names. */
export type ReticulumInterfaceType =
  | "TCPClientInterface"
  | "TCPServerInterface"
  | "AutoInterface"
  | "RNodeInterface";

/** A single managed Reticulum interface (flat wire shape). Only the fields for
 *  the chosen {@link ReticulumInterfaceType} are populated. */
export interface ReticulumInterface {
  /** Interface name — unique; the `[[name]]` config block header. */
  name: string;
  /** Whether rnsd should bring the interface up. */
  enabled: boolean;
  /** Interface class. */
  type: ReticulumInterfaceType;

  // TCPClientInterface
  /** Remote rnsd host/IP to dial (TCPClientInterface). */
  target_host?: string;
  /** Remote TCP port (TCPClientInterface). */
  target_port?: number;

  // TCPServerInterface
  /** Bind address, e.g. 127.0.0.1 (TCPServerInterface). */
  listen_ip?: string;
  /** Bind port (TCPServerInterface). */
  listen_port?: number;

  // AutoInterface (all optional)
  /** Isolate to peers sharing this group id (AutoInterface). */
  group_id?: string;
  /** link | admin | site | organisation | global (AutoInterface). */
  discovery_scope?: string;
  /** Discovery UDP port (AutoInterface). */
  discovery_port?: number;
  /** Data UDP port (AutoInterface). */
  data_port?: number;

  // RNodeInterface (LoRa)
  /** Serial device / RNode port (RNodeInterface). */
  port?: string;
  /** Centre frequency in Hz (RNodeInterface). */
  frequency?: number;
  /** Bandwidth in Hz (RNodeInterface). */
  bandwidth?: number;
  /** TX power in dBm (RNodeInterface). */
  txpower?: number;
  /** LoRa spreading factor 7–12 (RNodeInterface). */
  spreadingfactor?: number;
  /** LoRa coding rate 5–8 (RNodeInterface). */
  codingrate?: number;
}

/** List the interfaces in the isolated rnsd config. `[]` on web. */
export async function listReticulumInterfaces(): Promise<ReticulumInterface[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ReticulumInterface[]>("reticulum_interface_list");
  } catch (err) {
    console.warn("[reticulum] interface list failed:", err);
    return [];
  }
}

/** Add a new interface. Rejects (throws) if the name is already in use. */
export async function addReticulumInterface(
  iface: ReticulumInterface,
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reticulum_interface_add", { iface });
}

/** Replace an interface by name (add-or-replace). */
export async function updateReticulumInterface(
  iface: ReticulumInterface,
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reticulum_interface_update", { iface });
}

/** Delete the named interface. The loopback interface is protected (throws). */
export async function deleteReticulumInterface(name: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reticulum_interface_delete", { name });
}

/** Enable or disable the named interface. */
export async function setReticulumInterfaceEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reticulum_interface_set_enabled", { name, enabled });
}

/** The name of the mandatory loopback interface — shown read-only in the UI
 *  (it can't be deleted; deleting it is rejected native-side). */
export const RETICULUM_LOOPBACK_NAME = "Concord Loopback TCP";
