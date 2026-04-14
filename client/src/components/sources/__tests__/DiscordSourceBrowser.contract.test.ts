import { describe, expect, it } from "vitest";
import source from "../DiscordSourceBrowser.tsx?raw";

describe("DiscordSourceBrowser contracts", () => {
  it("persists voice mappings per user so disconnected bridges still show up in the menu", () => {
    expect(source).toContain("concord_discord_voice_mappings:");
    expect(source).toContain("concord_discord_voice_channels:");
    expect(source).toContain("readCachedVoiceMappings");
    expect(source).toContain("writeCachedVoiceMappings");
    expect(source).toContain("readCachedVoiceChannels");
    expect(source).toContain("writeCachedVoiceChannels");
    expect(source).toContain("useState<DiscordVoiceBridgeRoom[]>(");
    expect(source).not.toContain("if (!mapping.enabled) continue;");
  });

  it("opens bridged voice entries as voice channels on the Discord guild server", () => {
    expect(source).toContain("resolveDiscordVoiceEntry");
    expect(source).toContain("entry.roomId === channel.roomId || entry.channelId === channel.channelId");
    expect(source).toContain('channelType: channel.kind === "voice" ? "voice" : "text"');
    expect(source).toContain('preferBridgeServer: channel.kind === "voice"');
    expect(source).toContain("await joinVoiceSession({");
  });

  it("offers a direct bridge reload action from the discord source browser", () => {
    expect(source).toContain("discordVoiceBridgeHttpRestart");
    expect(source).toContain("Reload bridge");
    expect(source).toContain("handleReloadBridge");
  });

  it("refreshes Discord guild and voice-channel metadata when loading saved mappings", () => {
    expect(source).toContain("setDiscordGuilds(guilds);");
    expect(source).toContain("setResolvedGuildNames((previous) => {");
    expect(source).toContain("discordBridgeHttpGetChannel(accessToken, room.discord_channel_id)");
  });

  it("supports bridging a Discord server directly by server ID", () => {
    expect(source).toContain("Bridge by Discord Server ID");
    expect(source).toContain('await client.sendTextMessage(mgmtRoom, `guilds bridge ${guildId}`)');
  });
});
