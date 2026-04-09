import { describe, expect, it } from "vitest";
import { computeInitialServerConnected } from "../serverPickerGate";

describe("computeInitialServerConnected", () => {
  it("skips the picker on desktop web when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: false,
        isMobile: false,
        hasNewConfig: false,
        hasLegacyUrl: false,
      }),
    ).toBe(true);
  });

  it("shows the picker on mobile web when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: false,
        isMobile: true,
        hasNewConfig: false,
        hasLegacyUrl: false,
      }),
    ).toBe(false);
  });

  it("shows the picker on Tauri desktop when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: true,
        isMobile: false,
        hasNewConfig: false,
        hasLegacyUrl: false,
      }),
    ).toBe(false);
  });

  it("shows the picker on Tauri mobile (iOS/Android native) when no config is set", () => {
    expect(
      computeInitialServerConnected({
        isDesktop: true,
        isMobile: true,
        hasNewConfig: false,
        hasLegacyUrl: false,
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
            hasLegacyUrl: false,
          }),
        ).toBe(true);
      }
    }
  });

  it("skips the picker on any platform once legacy _serverUrl is set", () => {
    for (const isDesktop of [true, false]) {
      for (const isMobile of [true, false]) {
        expect(
          computeInitialServerConnected({
            isDesktop,
            isMobile,
            hasNewConfig: false,
            hasLegacyUrl: true,
          }),
        ).toBe(true);
      }
    }
  });
});
