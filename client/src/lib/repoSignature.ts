/**
 * S5 — Ed25519 index-signature verification for the community extension
 * repository protocol (`concord-repo/v1`).
 *
 * A repo MAY ship an optional `signing` block:
 *
 *   "signing": {
 *     "public_key": "ed25519:BASE64",      // raw 32-byte key, base64
 *     "index_sig":  "BASE64_DETACHED"      // detached signature
 *   }
 *
 * The signature is computed over the **canonical bytes of the index with
 * `index_sig` blanked out and object keys sorted** (so the signer and the
 * verifier agree on exactly what bytes were signed regardless of how the
 * JSON was originally serialized). This module:
 *
 *   1. canonicalizes an index object → deterministic UTF-8 bytes,
 *   2. verifies a detached Ed25519 signature over those bytes.
 *
 * Trust policy (driven by the caller, not here): a repo whose signature
 * verifies against a **pinned / bundled** key is "verified"; everything
 * else — no signing block, bad signature, or a key we don't trust — is
 * "unverified". Signing NEVER blocks install; it only drives the badge.
 *
 * WebCrypto's `Ed25519` algorithm is used directly (available in Node 20+
 * and all current Chromium/WebKit/Gecko targets, which is the full set of
 * Concord client environments). No third-party crypto dependency.
 */

/* ── base64 helpers ─────────────────────────────────────────────── */

/** Decode a standard (non-url) base64 string to raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ── canonicalization ───────────────────────────────────────────── */

/**
 * Deterministic JSON serialization: object keys sorted ascending at every
 * level, arrays preserved in order, no insignificant whitespace. Matches
 * what a repo's `build-index` signer must emit before signing.
 */
export function canonicalJSONStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJSONStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJSONStringify(obj[k])}`,
  );
  return `{${parts.join(",")}}`;
}

/**
 * Produce the canonical signed bytes for an index object: a structural
 * deep clone with `signing.index_sig` blanked to the empty string, then
 * canonical-stringified and UTF-8 encoded.
 *
 * Blanking (rather than deleting) `index_sig` keeps the `signing` object
 * shape stable between sign-time and verify-time — the signer fills the
 * field in AFTER computing the signature over the blanked form.
 */
export function canonicalIndexBytes(index: unknown): Uint8Array {
  const clone = JSON.parse(JSON.stringify(index)) as Record<string, unknown>;
  const signing = clone["signing"];
  if (signing && typeof signing === "object") {
    (signing as Record<string, unknown>)["index_sig"] = "";
  }
  return new TextEncoder().encode(canonicalJSONStringify(clone));
}

/* ── verification ───────────────────────────────────────────────── */

/**
 * Parse an `ed25519:BASE64` public-key string to raw 32 key bytes.
 * Returns null on a malformed prefix / length.
 */
export function parseEd25519PublicKey(pk: string): Uint8Array | null {
  const prefix = "ed25519:";
  if (!pk.startsWith(prefix)) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(pk.slice(prefix.length));
  } catch {
    return null;
  }
  // Ed25519 raw public keys are exactly 32 bytes.
  return bytes.length === 32 ? bytes : null;
}

function getSubtle(): SubtleCrypto | null {
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  return c?.subtle ?? null;
}

/**
 * Verify a detached Ed25519 signature over the canonical bytes of an
 * index object.
 *
 * @param index     the parsed index object (its `signing.index_sig` is
 *                   blanked internally before hashing — pass it as-fetched).
 * @param publicKey `ed25519:BASE64` key to verify against (the trusted /
 *                   pinned key for "verified", or the index's own key for
 *                   a self-consistency check).
 * @param signature base64 detached signature (`signing.index_sig`).
 * @returns true only when the signature cryptographically verifies; false
 *          on any malformed input or verification failure. NEVER throws —
 *          a verification miss must degrade to "unverified", not crash.
 */
export async function verifyIndexSignature(
  index: unknown,
  publicKey: string,
  signature: string,
): Promise<boolean> {
  const subtle = getSubtle();
  if (!subtle) return false;

  const rawKey = parseEd25519PublicKey(publicKey);
  if (!rawKey) return false;

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64ToBytes(signature);
  } catch {
    return false;
  }
  // Ed25519 signatures are exactly 64 bytes.
  if (sigBytes.length !== 64) return false;

  try {
    const key = await subtle.importKey(
      "raw",
      rawKey as unknown as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const data = canonicalIndexBytes(index);
    return await subtle.verify(
      "Ed25519",
      key,
      sigBytes as unknown as ArrayBuffer,
      data as unknown as ArrayBuffer,
    );
  } catch {
    // Algorithm unsupported in this runtime, bad key import, etc.
    return false;
  }
}
