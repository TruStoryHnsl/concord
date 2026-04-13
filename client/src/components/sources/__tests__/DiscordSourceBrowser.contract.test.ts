import { describe, expect, it } from "vitest";
import source from "../DiscordSourceBrowser.tsx?raw";

describe("DiscordSourceBrowser contracts", () => {
  it("persists voice mappings per user so disconnected bridges still show up in the menu", () => {
    expect(source).toContain("concord_discord_voice_mappings:");
    expect(source).toContain("readCachedVoiceMappings");
    expect(source).toContain("writeCachedVoiceMappings");
    expect(source).toContain("useState<DiscordVoiceBridgeRoom[]>(");
  });

  it("offers a direct bridge reload action from the discord source browser", () => {
    expect(source).toContain("discordVoiceBridgeHttpRestart");
    expect(source).toContain("Reload bridge");
    expect(source).toContain("handleReloadBridge");
  });
});
