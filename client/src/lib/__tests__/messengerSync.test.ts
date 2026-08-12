/**
 * Cold-session coverage for messengerSync — the superuser roaming bridge
 * (client half, client/src/lib/messengerSync.ts).
 *
 * N2 cold-reader test. Roaming's user-visible promise: the SAME user
 * opening the browser at the instance domain finds their device state
 * intact. We verify the two web-side halves of that:
 *   - prefs HYDRATE — a theme the device pushed is applied to the browser
 *     session (the personalization the user set on their phone carries);
 *   - roamed history READ — the browser reads the device-pushed
 *     conversations/messages/contacts from /api/me/sync, and retracted
 *     (deleted) rows do NOT come back (read-only mirror, honest deletes).
 * And the guardrail: the web session never PUSHES — roaming push is
 * native-only, so a browser must not fire sync writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRoamedHistory,
  getDeviceId,
  hydrateRoamingPrefs,
  startMessengerSync,
  stopMessengerSync,
} from "../messengerSync";
import { useAuthStore } from "../../stores/auth";
import { useSettingsStore } from "../../stores/settings";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("messengerSync — web roaming (hydrate + read-only history)", () => {
  beforeEach(() => {
    // Web build: no Tauri global.
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    useAuthStore.setState({ accessToken: "roam-token" });
    stopMessengerSync();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ accessToken: null });
    stopMessengerSync();
  });

  it("hydrates a device-roamed theme into the browser session", async () => {
    // Browser starts on a different theme than the device pushed.
    useSettingsStore.setState({ themePreset: "kinetic-node" as never });

    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url).includes("/me/sync/prefs")) {
        return Promise.resolve(
          jsonResponse([
            { key: "prefs", data: { themePreset: "roamed-theme" }, deleted: false },
          ]),
        );
      }
      return Promise.resolve(jsonResponse([]));
    });

    await hydrateRoamingPrefs();

    // The user's device-side theme choice now shows in the browser.
    expect(useSettingsStore.getState().themePreset).toBe("roamed-theme");
  });

  it("reads device-pushed history and drops retracted rows", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/me/sync/conversation")) {
        return Promise.resolve(
          jsonResponse([
            { key: "peerA", data: { lastPreview: "hi from phone" }, deleted: false },
            { key: "peerGONE", data: {}, deleted: true },
          ]),
        );
      }
      if (u.includes("/me/sync/message")) {
        return Promise.resolve(
          jsonResponse([
            { key: "m1", data: { conversation: "peerA", body: "roamed body" }, deleted: false },
          ]),
        );
      }
      if (u.includes("/me/sync/contact")) {
        return Promise.resolve(
          jsonResponse([
            { key: "peerA", data: { label: "Phone Bob" }, deleted: false },
          ]),
        );
      }
      return Promise.resolve(jsonResponse([]));
    });

    const roamed = await fetchRoamedHistory();

    // The device-pushed conversation surfaces...
    expect(roamed.conversations.map((c) => c.key)).toEqual(["peerA"]);
    // ...the retracted one does NOT come back.
    expect(roamed.conversations.some((c) => c.key === "peerGONE")).toBe(false);
    expect(roamed.messages[0].data.body).toBe("roamed body");
    expect(roamed.contacts[0].data.label).toBe("Phone Bob");
  });

  it("the web session never PUSHES sync (roaming push is native-only)", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    startMessengerSync();
    // No push loop, no network write on web.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("assigns a stable device id for roaming attribution", () => {
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });
});
