// Client for the user-initiated instance update (single-image docker deploy).
// Every call is admin-gated server-side; non-admins get 403 (apiFetch throws),
// which the UI treats as "feature not available to you" and hides the section.
import { apiFetch } from "../api/concord";

export interface InstanceUpdateStatus {
  version: string;
  image_ref: string;
  build_digest: string | null;
  /** False when the docker socket isn't mounted — apply will be unavailable. */
  update_supported: boolean;
}

export interface InstanceUpdateCheck extends InstanceUpdateStatus {
  registry_ok: boolean;
  update_available: boolean;
  latest_digest: string | null;
  local_digest?: string | null;
  unknown_local?: boolean;
  message: string;
}

export interface InstanceUpdateApply {
  started: boolean;
  updater_container: string;
  compose_file: string;
}

export function getInstanceUpdateStatus(token: string) {
  return apiFetch<InstanceUpdateStatus>("/instance/update/status", {}, token);
}

export function checkInstanceUpdate(token: string) {
  return apiFetch<InstanceUpdateCheck>(
    "/instance/update/check",
    { method: "POST" },
    token,
  );
}

export function applyInstanceUpdate(token: string) {
  return apiFetch<InstanceUpdateApply>(
    "/instance/update/apply",
    { method: "POST" },
    token,
  );
}

// --- Full-stack update (multi-container compose deploy) --------------------
// Rebuilds AND relaunches ALL containers/images (never selective), health-gated
// with rollback. SECURITY-SENSITIVE server-side; admin-gated. See
// docs/architecture/docker-self-update-threat-model.md.

export interface FullStackUpdateStart {
  started: boolean;
  job_id: string;
  updater_container: string;
  compose_dir: string;
  message: string;
}

export type FullStackUpdatePhase =
  | "idle"
  | "starting"
  | "snapshot"
  | "pulling"
  | "building"
  | "recreating"
  | "health_check"
  | "success"
  | "rolling_back"
  | "rolled_back"
  | "rollback_failed"
  | "failed";

export interface FullStackUpdateStatus {
  phase: FullStackUpdatePhase;
  ok: boolean | null;
  message: string;
  job_id?: string;
  started_at?: number;
  updated_at?: number;
}

export function startFullStackUpdate(token: string) {
  return apiFetch<FullStackUpdateStart>(
    "/instance/update/full-stack",
    { method: "POST" },
    token,
  );
}

export function getFullStackUpdateStatus(token: string) {
  return apiFetch<FullStackUpdateStatus>(
    "/instance/update/full-stack/status",
    {},
    token,
  );
}

/** Phases from which no further progress will come (job is over). */
export const FULLSTACK_TERMINAL_PHASES: FullStackUpdatePhase[] = [
  "success",
  "rolled_back",
  "rollback_failed",
  "failed",
  "idle",
];
