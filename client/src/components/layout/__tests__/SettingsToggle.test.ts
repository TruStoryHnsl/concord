import { describe, expect, it } from "vitest";
import channelSidebarSource from "../ChannelSidebar.tsx?raw";
import chatLayoutSource from "../ChatLayout.tsx?raw";

describe("settings toggle wiring", () => {
  it("lets the desktop settings button close the open settings panel", () => {
    expect(channelSidebarSource).toContain("if (settingsOpen || serverSettingsId) {");
    expect(channelSidebarSource).toContain("closeServerSettings();");
    expect(channelSidebarSource).toContain("closeSettings();");
  });

  it("lets the mobile settings pill close the settings view", () => {
    expect(chatLayoutSource).toContain("if (mobileView === \"settings\" || settingsOpen || serverSettingsId) {");
    expect(chatLayoutSource).toContain("setMobileView(\"chat\");");
  });
});
