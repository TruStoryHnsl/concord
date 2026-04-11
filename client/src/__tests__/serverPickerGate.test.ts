import { describe, expect, it } from "vitest";
import { computeInitialServerConnected } from "../serverPickerGate";

describe("computeInitialServerConnected", () => {
  it("skips the picker on desktop web when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: false,
        isMobile: false,
        hasNewConfig: false,
      }),
    ).toBe(true);
  });

  it("shows the picker on mobile web when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: false,
        isMobile: true,
        hasNewConfig: false,
      }),
    ).toBe(false);
  });

  it("shows the picker on Tauri desktop when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: true,
        isMobile: false,
        hasNewConfig: false,
      }),
    ).toBe(false);
  });

  it("shows the picker on Tauri mobile (iOS/Android native) when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: true,
        isMobile: true,
        hasNewConfig: false,
      }),
    ).toBe(false);
  });

  it("skips the picker on any platform once serverConfig has a HomeserverConfig", () => {
    for (const isDesktop of [true, false]) {
      for (const isMobile of [true, false]) {
        expect(
          computeInitialServerConnected({
            isDesktop,
            isMobile,
            hasNewConfig: true,
          }),
        ).toBe(true);
      }
    }
  });

  // Regression guard: before this commit the gate had a
  // `hasLegacyUrl` input that read Tauri's plugin-store `server_url`
  // slot. A stale value in that slot (from Syncthing, a previous
  // install, or a hand-edited settings.json) could silently skip the
  // picker even though the user had never chosen a server in THIS
  // session — effectively leaking a persisted hostname across
  // otherwise-independent installs. The legacy gate is gone. This
  // test exists to make sure it doesn't come back.
  it("ignores any legacy _serverUrl value — picker shows on native regardless", () => {
    // Even if the legacy slot was set to something (we no longer
    // even accept it as an input), the gate must still show the
    // picker on a native build that hasn't completed one.
    const input = {
      isDesktop: true,
      isMobile: false,
      hasNewConfig: false,
    } as const;
    expect(computeInitialServerConnected(input)).toBe(false);
  });
});
