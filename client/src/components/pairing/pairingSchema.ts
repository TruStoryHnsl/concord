/**
 * Pairing payload schema (INS-022).
 *
 * A QR code generated on the host phone encodes this payload so a guest
 * phone can scan it and populate its `useServerConfigStore` with a
 * `HomeserverConfig` that matches what `discoverHomeserver()` in
 * `api/wellKnown.ts` would have produced. The shapes intentionally
 * overlap — the decoder returns a `HomeserverConfig`-compatible object
 * so the rest of the app treats a QR-scanned server identically to a
 * discovered one.
 *
 * Versioning: the payload carries an explicit `v` tag. A future breaking
 * change will bump the tag; current scanners that see an unknown
 * version must reject the payload rather than attempt lossy coercion.
 *
 * Transport format: the payload is JSON-serialized then embedded in a
 * URL of the form
 *
 *   concord+pair://v1/?d=<base64url-encoded-json>
 *
 * Using a URL scheme (rather than bare JSON) keeps the QR self-describing
 * — deep-link handlers on iOS/Android can route a scan through the OS
 * camera app into the Concord app directly, bypassing the in-app
 * scanner entirely on platforms where that's wired up.
 */

import type { HomeserverConfig } from "../../api/wellKnown";

/**
 * The serialized wire shape. Fields are deliberately a *strict subset*
 * of `HomeserverConfig` — we do not transmit ephemeral fields like
 * `features` (server-published; re-discover on the guest) or TURN
 * credentials (security-sensitive; must be fetched over TLS).
 */
export interface PairingPayloadV1 {
  /** Schema version tag — always `1` for this module. */
  v: 1;
  /** Instance hostname (no scheme). Matches `HomeserverConfig.host`. */
  host: string;
  /** Matrix homeserver base URL (HTTPS). */
  homeserver_url: string;
  /** Concord API base URL (HTTPS). */
  api_base: string;
  /** Optional canonical Matrix server_name. */
  server_name?: string;
  /** Optional LiveKit signaling URL (wss:// or https://). */
  livekit_url?: string;
  /** Optional human-readable instance name. */
  instance_name?: string;
}

export const PAIRING_URL_SCHEME = "concord+pair";
export const PAIRING_URL_PREFIX = `${PAIRING_URL_SCHEME}://v1/?d=`;

/** Raised when a decode input is not a valid pairing payload. */
export class PairingDecodeError extends Error {
  constructor(reason: string) {
    super(`invalid pairing payload: ${reason}`);
    this.name = "PairingDecodeError";
  }
}

/**
 * base64url encode a UTF-8 string (`+` → `-`, `/` → `_`, strip `=`).
 * Works identically in the browser and in jsdom (Node 22 has a
 * `btoa` shim in jsdom).
 */
function b64urlEncode(raw: string): string {
  const utf8 = new TextEncoder().encode(raw);
  let binary = "";
  for (let i = 0; i < utf8.length; i++) {
    binary += String.fromCharCode(utf8[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(encoded: string): string {
  // Restore padding so `atob` accepts the string.
  let padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Encode a HomeserverConfig (or partial) into a pairing URL string.
 * Only the fields listed in `PairingPayloadV1` are preserved — extras
 * are dropped silently, which is the correct behavior: leaking
 * operator-internal fields via a QR handed to a guest is a privacy
 * regression.
 */
export function encodePairingPayload(
  source: Pick<HomeserverConfig, "host" | "homeserver_url" | "api_base"> &
    Partial<Pick<HomeserverConfig, "server_name" | "livekit_url" | "instance_name">>,
): string {
  const payload: PairingPayloadV1 = {
    v: 1,
    host: source.host,
    homeserver_url: source.homeserver_url,
    api_base: source.api_base,
  };
  if (source.server_name) payload.server_name = source.server_name;
  if (source.livekit_url) payload.livekit_url = source.livekit_url;
  if (source.instance_name) payload.instance_name = source.instance_name;
  const json = JSON.stringify(payload);
  return `${PAIRING_URL_PREFIX}${b64urlEncode(json)}`;
}

/**
 * Validate a string is a well-formed HTTPS URL (or wss:// for
 * LiveKit). Used to reject downgrade attacks — a QR that encodes an
 * http:// homeserver must NOT silently be accepted.
 */
function requireSecureUrl(raw: unknown, label: string, allowWss = false): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new PairingDecodeError(`${label} is not a non-empty string`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new PairingDecodeError(`${label} is not a parsable URL`);
  }
  if (parsed.protocol !== "https:" && !(allowWss && parsed.protocol === "wss:")) {
    throw new PairingDecodeError(
      `${label} must use https:// (got ${parsed.protocol})`,
    );
  }
  return raw.replace(/\/+$/g, "");
}

/**
 * Decode a pairing URL (or raw base64url payload) back into a
 * `HomeserverConfig`-compatible object suitable for
 * `useServerConfigStore.setHomeserver`.
 */
export function decodePairingPayload(input: string): HomeserverConfig {
  if (typeof input !== "string" || input.length === 0) {
    throw new PairingDecodeError("empty input");
  }

  let encoded: string;
  if (input.startsWith(PAIRING_URL_PREFIX)) {
    encoded = input.slice(PAIRING_URL_PREFIX.length);
  } else if (input.startsWith(`${PAIRING_URL_SCHEME}://`)) {
    throw new PairingDecodeError("unsupported pairing URL version");
  } else {
    // Permissive fallback: allow a bare base64url payload for
    // manual-paste / debugging paths. The strict path is the URL.
    encoded = input;
  }

  let json: string;
  try {
    json = b64urlDecode(encoded);
  } catch (err) {
    throw new PairingDecodeError(`base64url decode failed: ${String(err)}`);
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (err) {
    throw new PairingDecodeError(`JSON parse failed: ${String(err)}`);
  }
  if (obj === null || typeof obj !== "object") {
    throw new PairingDecodeError("payload is not a JSON object");
  }
  const body = obj as Record<string, unknown>;
  if (body.v !== 1) {
    throw new PairingDecodeError(`unsupported version tag: ${String(body.v)}`);
  }

  const host = body.host;
  if (typeof host !== "string" || host.length === 0) {
    throw new PairingDecodeError("host is required");
  }

  const homeserver_url = requireSecureUrl(body.homeserver_url, "homeserver_url");
  const api_base = requireSecureUrl(body.api_base, "api_base");
  const server_name =
    typeof body.server_name === "string" && body.server_name.length > 0
      ? body.server_name
      : undefined;
  const livekit_url =
    typeof body.livekit_url === "string" && body.livekit_url.length > 0
      ? requireSecureUrl(body.livekit_url, "livekit_url", true)
      : undefined;
  const instance_name =
    typeof body.instance_name === "string" && body.instance_name.length > 0
      ? body.instance_name
      : undefined;

  return {
    host,
    homeserver_url,
    api_base,
    server_name,
    livekit_url,
    instance_name,
  };
}
