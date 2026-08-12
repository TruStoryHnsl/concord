/**
 * userSources — REST wrappers for the core instance's per-user source
 * catalogue (`/api/me/sources`) and persona bindings (`/api/me/personas`).
 *
 * The docker instance acts as a portal: each account stores its own
 * catalogue of outward connections server-side so the sources rail
 * follows the user across browsers/devices. Descriptors only — access
 * tokens for remote services never leave the client.
 *
 * All functions take an EXPLICIT `apiBase` + `accessToken` (the core
 * instance's, captured at login) rather than the active-config
 * `getApiBase()`: after `switchToSource` the active config points at a
 * foreign instance, and the catalogue must keep talking to the user's
 * portal instance regardless.
 */

export type UserSourceKind = "matrix" | "reticulum" | "concord" | "concord-p2p";

export interface RemoteUserSource {
  id: string;
  kind: UserSourceKind;
  host: string;
  display_name: string | null;
  api_base: string | null;
  homeserver_url: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RemotePersonaBinding {
  persona_id: string;
  persona_pubkey: string | null;
  label: string | null;
  created_at: string;
}

async function meFetch<T>(
  apiBase: string,
  accessToken: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const base = apiBase.replace(/\/+$/, "");
  const resp = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export function listMySources(
  apiBase: string,
  accessToken: string,
): Promise<RemoteUserSource[]> {
  return meFetch(apiBase, accessToken, "/me/sources");
}

export function upsertMySource(
  apiBase: string,
  accessToken: string,
  source: {
    kind: UserSourceKind;
    host: string;
    display_name?: string | null;
    api_base?: string | null;
    homeserver_url?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<RemoteUserSource> {
  return meFetch(apiBase, accessToken, "/me/sources", {
    method: "POST",
    body: JSON.stringify(source),
  });
}

export function deleteMySource(
  apiBase: string,
  accessToken: string,
  sourceId: string,
): Promise<{ ok: boolean }> {
  return meFetch(
    apiBase,
    accessToken,
    `/me/sources/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" },
  );
}

export function listMyPersonas(
  apiBase: string,
  accessToken: string,
): Promise<RemotePersonaBinding[]> {
  return meFetch(apiBase, accessToken, "/me/personas");
}

export function claimPersona(
  apiBase: string,
  accessToken: string,
  binding: { persona_id: string; persona_pubkey?: string; label?: string },
): Promise<RemotePersonaBinding> {
  return meFetch(apiBase, accessToken, "/me/personas", {
    method: "POST",
    body: JSON.stringify(binding),
  });
}

export function releasePersona(
  apiBase: string,
  accessToken: string,
  personaId: string,
): Promise<{ ok: boolean }> {
  return meFetch(
    apiBase,
    accessToken,
    `/me/personas/${encodeURIComponent(personaId)}`,
    { method: "DELETE" },
  );
}
