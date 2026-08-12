/**
 * Reticulum pillar admin + mesh API (web/docker instance node).
 *
 * The docker instance runs its own in-process RNS pillar
 * (server/services/reticulum_node.py). These calls surface and edit
 * THAT node — not the native app's embedded stack:
 *
 * - `GET  /api/reticulum/mesh`   — live mesh snapshot (any user).
 * - `GET  /api/admin/reticulum`  — full operator config (admin only).
 * - `PUT  /api/admin/reticulum`  — partial config update (admin only);
 *   `outbound_interfaces`, when present, REPLACES the outbound link set.
 */

import { apiFetch } from "./concord";

/** One outbound TCPClientInterface link of the instance pillar. */
export interface OutboundInterface {
  name: string;
  target_host: string;
  target_port: number;
  enabled: boolean;
}

/** LXMF propagation-node status block (mesh + status endpoints). */
export interface LxmfStatus {
  available: boolean;
  enabled: boolean;
  running: boolean;
  propagation_destination: string | null;
  error: string | null;
}

export interface ReticulumMeshSnapshot {
  running: boolean;
  mode: string;
  identity: string | null;
  dest: string | null;
  display_name?: string | null;
  listen_port: number;
  interfaces: Array<{
    name: string;
    online: boolean;
    mode?: number | null;
    bitrate?: number | null;
    rxb?: number;
    txb?: number;
  }>;
  announces: Array<{
    dest: string;
    hops: number | null;
    name: string | null;
    last_heard: number;
  }>;
  lxmf?: LxmfStatus;
}

export interface ReticulumAdminView {
  config: {
    mode: string;
    entry_domain: string | null;
    listen_host: string;
    listen_port: number;
    announce_interval_secs: number;
    display_name: string;
    outbound_interfaces: OutboundInterface[];
    lxmf_propagation_enabled: boolean;
  };
  status: Record<string, unknown> & { lxmf?: LxmfStatus };
  limits: {
    modes: string[];
    announce_interval_secs: { min: number; max: number };
    outbound_interfaces_max?: number;
  };
}

export interface ReticulumAdminUpdate {
  mode?: string;
  entry_domain?: string;
  listen_port?: number;
  announce_interval_secs?: number;
  display_name?: string;
  outbound_interfaces?: OutboundInterface[];
  lxmf_propagation_enabled?: boolean;
}

export interface ReticulumAdminPutResult {
  saved: boolean;
  running?: boolean;
  restart_required?: boolean;
  warning?: string;
}

export async function fetchReticulumMesh(
  accessToken: string,
): Promise<ReticulumMeshSnapshot> {
  return apiFetch("/reticulum/mesh", {}, accessToken);
}

export async function fetchReticulumAdmin(
  accessToken: string,
): Promise<ReticulumAdminView> {
  return apiFetch("/admin/reticulum", {}, accessToken);
}

export async function updateReticulumAdmin(
  accessToken: string,
  body: ReticulumAdminUpdate,
): Promise<ReticulumAdminPutResult> {
  return apiFetch(
    "/admin/reticulum",
    { method: "PUT", body: JSON.stringify(body) },
    accessToken,
  );
}
