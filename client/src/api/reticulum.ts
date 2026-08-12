/**
 * reticulum — web API for the docker instance's reticulum pillar node.
 *
 * Distinct from `api/reticulumInterfaces.ts` (native-only Tauri IPC to
 * the embedded rnsd): these endpoints talk to the CORE INSTANCE's
 * server-side RNS node over HTTP — the pillar that gives web users (and
 * native users without an always-on machine) a mesh entrypoint and a
 * message transport.
 */

import { apiFetch } from "./concord";

export interface ReticulumStatus {
  mode: "off" | "private" | "public";
  available: boolean;
  running: boolean;
  mailbox_destination: string | null;
}

export interface ReticulumEntrypoint {
  mode: "private" | "public";
  domain: string | null;
  port: number;
  pillar_identity: string | null;
  mailbox_destination: string | null;
  interface_type: "TCPClientInterface";
}

export function getReticulumStatus(accessToken: string): Promise<ReticulumStatus> {
  return apiFetch("/reticulum/status", {}, accessToken);
}

/**
 * The routing descriptor for this instance's entrypoint. 404 when the
 * node is off — or, in private mode, when the caller is not a validated
 * (persona-bound) user; the two are deliberately indistinguishable.
 */
export function getReticulumEntrypoint(
  accessToken: string,
): Promise<ReticulumEntrypoint> {
  return apiFetch("/reticulum/entrypoint", {}, accessToken);
}

/** Send a RelayFrame v1 text over the mesh via the pillar. */
export function sendReticulumText(
  accessToken: string,
  params: {
    destination_hash: string;
    persona_id: string;
    body: string;
    from_name?: string;
  },
): Promise<{ sent: boolean }> {
  return apiFetch(
    "/reticulum/send",
    { method: "POST", body: JSON.stringify(params) },
    accessToken,
  );
}
