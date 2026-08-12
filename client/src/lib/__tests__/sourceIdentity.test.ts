import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isLocalInstanceSource } from "../sourceIdentity";

/**
 * Regression tests for the empirically-observed native bug (2026-06-14):
 * after a native user linked linked.example.test via the picker and switched to
 * it, the linked.example.test tile reported "this is your local home instance and
 * can't be disconnected." Root cause: local-vs-remote identity was derived
 * from the ACTIVE serverConfig, so the active foreign instance read as
 * local. These tests lock in the stable, runtime-based contract:
 *   - native  → NO ConcordSource is ever local (the porch is, and it is a
 *               synthetic non-source tile), so every linked source is
 *               disconnectable;
 *   - web     → only the origin-served instance is local.
 *
 * The assertions are written from the user's perspective: "can I disconnect
 * the linked.example.test tile?" maps directly to `!isLocalInstanceSource(...)`.
 */

// `isLocalInstanceSource` consults `isTauriRuntime()`, which reads
// `"__TAURI_INTERNALS__" in window` — the real Tauri v2 global. Tests
// toggle it on `window` to exercise both runtimes.
const TAURI_KEY = "__TAURI_INTERNALS__";

function setNative(on: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (on) (window as any)[TAURI_KEY] = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  else delete (window as any)[TAURI_KEY];
}

describe("isLocalInstanceSource", () => {
  beforeEach(() => {
    setNative(false);
  });
  afterEach(() => {
    setNative(false);
    vi.unstubAllGlobals();
  });

  it("explicit isLocal:true is local regardless of runtime (non-disconnectable)", () => {
    setNative(true);
    expect(isLocalInstanceSource({ host: "anything.test", isLocal: true })).toBe(true);
    setNative(false);
    expect(isLocalInstanceSource({ host: "anything.test", isLocal: true })).toBe(true);
  });

  it("explicit isLocal:false is NOT local even for a primary-looking source", () => {
    setNative(true);
    // A token-less foreign login (now possible) marks isLocal:false — it
    // must stay disconnectable and visible, not be mistaken for home.
    expect(isLocalInstanceSource({ host: "linked.example.test", isLocal: false })).toBe(false);
  });

  it("native fallback (unflagged): a linked instance is NOT local → disconnectable", () => {
    setNative(true);
    expect(isLocalInstanceSource({ host: "linked.example.test" })).toBe(false);
  });

  it("native: even a localhost-looking source is NOT local (the porch is, and it is not a source)", () => {
    setNative(true);
    expect(isLocalInstanceSource({ host: "localhost" })).toBe(false);
  });

  it("web: the origin-served instance IS local → not disconnectable", () => {
    setNative(false);
    vi.stubGlobal("window", {
      ...window,
      location: { hostname: "chat.example.test" },
    });
    expect(isLocalInstanceSource({ host: "chat.example.test" })).toBe(true);
    // Case-insensitive host match.
    expect(isLocalInstanceSource({ host: "Chat.Example.Test" })).toBe(true);
  });

  it("web: a linked instance on a different host is remote → disconnectable", () => {
    setNative(false);
    vi.stubGlobal("window", {
      ...window,
      location: { hostname: "chat.example.test" },
    });
    expect(isLocalInstanceSource({ host: "linked.example.test" })).toBe(false);
  });
});
