import { describe, it, expect } from "vitest";
import {
  canonicalJSONStringify,
  canonicalIndexBytes,
  parseEd25519PublicKey,
  verifyIndexSignature,
} from "../repoSignature";

/* Helpers — generate a real Ed25519 keypair via WebCrypto and produce a
 * detached signature over the canonical index bytes, exactly as a repo's
 * `build-index` signer would. This proves the verifier accepts genuinely
 * signed indexes and rejects tampered / absent / wrong-key ones — a
 * user-oriented assertion: a signed repo shows "verified", a bad one does
 * not. */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function makeSigner() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const publicKey = `ed25519:${bytesToBase64(rawPub)}`;

  async function sign(index: unknown): Promise<string> {
    const data = canonicalIndexBytes(index);
    const sig = new Uint8Array(
      await crypto.subtle.sign("Ed25519", kp.privateKey, data as unknown as ArrayBuffer),
    );
    return bytesToBase64(sig);
  }

  return { publicKey, sign };
}

function baseIndex() {
  return {
    schema: "concord-repo/v1",
    repo_id: "concord-extensions",
    name: "Concord Extensions",
    maintainer: "TruStoryHnsl",
    signing: { public_key: "", index_sig: "" },
    extensions: [
      {
        id: "com.concord.whiteboard",
        name: "Whiteboard",
        latest: "1.0.0",
        versions: [
          {
            version: "1.0.0",
            bundle_url: "com.concord.whiteboard/1.0.0/bundle.zip",
            integrity: "sha384-AAAA",
          },
        ],
      },
    ],
  };
}

describe("canonicalJSONStringify", () => {
  it("sorts object keys deterministically regardless of insertion order", () => {
    const a = canonicalJSONStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalJSONStringify({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  it("preserves array order", () => {
    expect(canonicalJSONStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("canonicalIndexBytes", () => {
  it("blanks index_sig so sign-time and verify-time bytes match", () => {
    const signed = { ...baseIndex(), signing: { public_key: "ed25519:X", index_sig: "DEADBEEF" } };
    const blanked = { ...baseIndex(), signing: { public_key: "ed25519:X", index_sig: "" } };
    const a = new TextDecoder().decode(canonicalIndexBytes(signed));
    const b = new TextDecoder().decode(canonicalIndexBytes(blanked));
    expect(a).toBe(b);
    expect(a).not.toContain("DEADBEEF");
  });
});

describe("parseEd25519PublicKey", () => {
  it("parses a valid ed25519: prefixed 32-byte key", async () => {
    const { publicKey } = await makeSigner();
    const raw = parseEd25519PublicKey(publicKey);
    expect(raw).not.toBeNull();
    expect(raw!.length).toBe(32);
  });

  it("rejects a missing prefix", () => {
    expect(parseEd25519PublicKey("AAAA")).toBeNull();
  });

  it("rejects a wrong-length key", () => {
    expect(parseEd25519PublicKey("ed25519:QUJD")).toBeNull(); // "ABC" → 3 bytes
  });
});

describe("verifyIndexSignature", () => {
  it("VALID signature → verified (true)", async () => {
    const { publicKey, sign } = await makeSigner();
    const index = baseIndex();
    const sig = await sign(index);
    // Caller verifies against the trusted/bundled key.
    const ok = await verifyIndexSignature(index, publicKey, sig);
    expect(ok).toBe(true);
  });

  it("TAMPERED index → unverified (false)", async () => {
    const { publicKey, sign } = await makeSigner();
    const index = baseIndex();
    const sig = await sign(index);
    // Mutate after signing — the bytes no longer match the signature.
    const tampered = JSON.parse(JSON.stringify(index));
    tampered.extensions[0].versions[0].bundle_url = "evil/bundle.zip";
    const ok = await verifyIndexSignature(tampered, publicKey, sig);
    expect(ok).toBe(false);
  });

  it("WRONG key → unverified (false)", async () => {
    const signer = await makeSigner();
    const other = await makeSigner();
    const index = baseIndex();
    const sig = await signer.sign(index);
    const ok = await verifyIndexSignature(index, other.publicKey, sig);
    expect(ok).toBe(false);
  });

  it("ABSENT/garbage signature → unverified (false), never throws", async () => {
    const { publicKey } = await makeSigner();
    const index = baseIndex();
    await expect(
      verifyIndexSignature(index, publicKey, "not-base-64!!!"),
    ).resolves.toBe(false);
    await expect(verifyIndexSignature(index, publicKey, "")).resolves.toBe(false);
  });

  it("malformed public key → unverified (false)", async () => {
    const { sign } = await makeSigner();
    const index = baseIndex();
    const sig = await sign(index);
    await expect(verifyIndexSignature(index, "not-a-key", sig)).resolves.toBe(false);
  });
});
