/**
 * DiscordSourceBrowser — browse and link Discord channels via the bot bridge.
 *
 * Screens:
 *   browse          — list of already-bridged rooms, grouped by guild space
 *   invite-bot      — open Discord OAuth2 invite URL so bot joins a server
 *   link-channel-id — enter a Discord channel ID to bridge
 *   link-test-msg   — optionally send a test message after bridging
 *   linking         — spinner while DM-ing the bridge bot and waiting for portal
 *   done            — success, optionally navigate to the new room
 *   error           — failure with back button
 *
 * Linking mechanism (client-side, no backend):
 *   1. Find or create a DM room with @discordbot:<server_domain>
 *   2. Send "bridge <channel_id>" to that DM
 *   3. Poll client.getRooms() for up to 12s for a room whose canonical alias
 *      matches _discord_\d+_<channelId>:
 *   4. Optionally send a test message to the portal room
 */

import { useState, useMemo, useCallback } from "react";
import { useAuthStore } from "../../stores/auth";
import { useServerStore } from "../../stores/server";
import { discordBridgeHttpGetInviteUrl, discordBridgeHttpLoginRelay } from "../../api/bridges";

// ── Alias parser ────────────────────────────────────────────────────────────

interface DiscordAliasInfo {
  guildId: string;
  channelId: string;
}

/** Parse a mautrix-discord canonical alias into guild/channel snowflakes. */
function parseDiscordAlias(alias: string): DiscordAliasInfo | null {
  // Format: #_discord_<guildId>_<channelId>:<server>
  const m = alias.match(/^#_discord_(\d+)_(\d+):/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2] };
}

// ── Wait for bridge portal ───────────────────────────────────────────────────

async function waitForPortal(
  client: ReturnType<typeof useAuthStore.getState>["client"],
  channelId: string,
  timeoutMs = 20000,
): Promise<{ roomId: string; name: string } | null> {
  if (!client) return null;
  const re = new RegExp(`_discord_\\d+_${channelId}:`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const room = client.getRooms().find(
      (r) =>
        r.getMyMembership() === "join" &&
        re.test(r.getCanonicalAlias() ?? ""),
    );
    if (room) return { roomId: room.roomId, name: room.name ?? room.roomId };
    await new Promise((res) => setTimeout(res, 600));
  }
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface BridgedChannel {
  roomId: string;
  name: string;
  guildId: string;
  channelId: string;
}

interface GuildGroup {
  guildId: string;
  guildName: string;
  channels: BridgedChannel[];
}

type Screen =
  | "browse"
  | "invite-bot"
  | "link-channel-id"
  | "link-test-msg"
  | "linking"
  | "done"
  | "error";

// ── Header ───────────────────────────────────────────────────────────────────

function Header({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {onBack && (
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>
      )}
      {/* Discord blurple accent dot */}
      <div className="w-2 h-2 rounded-full bg-[#5865F2] flex-shrink-0" />
      <h2 className="flex-1 text-lg font-headline font-semibold text-on-surface">
        {title}
      </h2>
      <button
        onClick={onClose}
        className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
      >
        <span className="material-symbols-outlined text-lg">close</span>
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function DiscordSourceBrowser({ onClose }: { onClose: () => void }) {
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);

  const accessToken = useAuthStore((s) => s.accessToken);

  const [screen, setScreen] = useState<Screen>("browse");
  const [channelId, setChannelId] = useState("");
  const [sendTestMsg, setSendTestMsg] = useState(true);
  const [testMsg, setTestMsg] = useState("✓ Concord bridge is working!");
  const [linkedRoom, setLinkedRoom] = useState<{ roomId: string; name: string } | null>(null);
  const [error, setError] = useState("");

  // Invite URL — fetched lazily when the invite-bot screen is opened.
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteUrlLoading, setInviteUrlLoading] = useState(false);

  const openInviteScreen = useCallback(async () => {
    setScreen("invite-bot");
    if (inviteUrl) return; // already fetched
    setInviteUrlLoading(true);
    try {
      if (!accessToken) throw new Error("Not logged in");
      const result = await discordBridgeHttpGetInviteUrl(accessToken);
      setInviteUrl(result.invite_url);
    } catch {
      // Non-fatal — show a manual fallback link
      setInviteUrl(null);
    } finally {
      setInviteUrlLoading(false);
    }
  }, [accessToken, inviteUrl]);

  // ── Build bridged-room list ────────────────────────────────────────────────

  const guildGroups: GuildGroup[] = useMemo(() => {
    if (!client) return [];

    const bridgedRooms: BridgedChannel[] = [];
    for (const room of client.getRooms()) {
      if (room.getMyMembership() !== "join") continue;
      const alias = room.getCanonicalAlias() ?? "";
      const info = parseDiscordAlias(alias);
      if (!info) continue;
      bridgedRooms.push({
        roomId: room.roomId,
        name: room.name ?? `#${info.channelId}`,
        guildId: info.guildId,
        channelId: info.channelId,
      });
    }

    // Group by guild. Try to find guild name from a space room.
    const guildMap = new Map<string, GuildGroup>();
    for (const ch of bridgedRooms) {
      if (!guildMap.has(ch.guildId)) {
        // Look for a space room that's the parent of this channel
        const spaceRoom = client.getRooms().find((r) => {
          const alias = r.getCanonicalAlias() ?? "";
          // Guild spaces have aliases like #_discord_<guildId>:<server>
          return (
            r.getType?.() === "m.space" &&
            alias.match(new RegExp(`^#_discord_${ch.guildId}:`))
          );
        });
        guildMap.set(ch.guildId, {
          guildId: ch.guildId,
          guildName: spaceRoom?.name ?? `Guild ${ch.guildId}`,
          channels: [],
        });
      }
      guildMap.get(ch.guildId)!.channels.push(ch);
    }

    return Array.from(guildMap.values()).sort((a, b) =>
      a.guildName.localeCompare(b.guildName),
    );
  }, [client]);

  // ── Navigate to a bridged room ─────────────────────────────────────────────

  const navigateTo = useCallback(
    (roomId: string) => {
      setActiveChannel(roomId);
      onClose();
    },
    [setActiveChannel, onClose],
  );

  // ── Link flow ─────────────────────────────────────────────────────────────

  const handleLink = useCallback(async () => {
    if (!client || !userId) {
      setError("Not connected to Matrix.");
      setScreen("error");
      return;
    }

    const trimmedId = channelId.trim();
    if (!/^\d{17,20}$/.test(trimmedId)) {
      setError("Channel ID must be 17–20 digits. Enable Developer Mode in Discord, then right-click a channel → Copy Channel ID.");
      setScreen("error");
      return;
    }

    setScreen("linking");

    try {
      // Derive bot user ID from our own Matrix user ID
      const serverDomain = userId.includes(":") ? userId.split(":")[1] : "";
      const botUserId = `@discordbot:${serverDomain}`;

      // Find existing DM room with the bridge bot.
      // We look for a small (≤2 member) room that is NOT a Discord bridge
      // room (no _discord_ alias) and contains the bot user.
      let dmRoomId: string | null = null;
      for (const room of client.getRooms()) {
        if (room.getMyMembership() !== "join") continue;
        const alias = room.getCanonicalAlias() ?? "";
        if (alias.includes("_discord_")) continue;
        const members = room.getJoinedMembers();
        if (
          members.length <= 2 &&
          members.some((m) => m.userId === botUserId)
        ) {
          dmRoomId = room.roomId;
          break;
        }
      }

      // Create DM room if none found
      if (!dmRoomId) {
        const created = await client.createRoom({
          is_direct: true,
          invite: [botUserId],
          // @ts-expect-error — matrix-js-sdk accepts string literal
          preset: "trusted_private_chat",
        });
        dmRoomId = created.room_id;
        // Brief pause for the bridge bot to join
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Ensure the bridge bot is logged into Discord. mautrix-discord v0.7.2
      // requires an explicit login-token command before processing bridge commands.
      // Fire-and-forget — if this fails (already logged in, no token) proceed anyway.
      if (accessToken) {
        try {
          await discordBridgeHttpLoginRelay(accessToken);
          // Give the Discord gateway handshake time to complete.
          await new Promise((r) => setTimeout(r, 4000));
        } catch {
          // Non-fatal — bridge may already be logged in from a previous session.
        }
      }

      // Send the bridge command
      await client.sendTextMessage(dmRoomId, `bridge ${trimmedId}`);

      // Wait for the portal room to be created
      const portal = await waitForPortal(client, trimmedId);

      if (!portal) {
        setError(
          "Bridge command sent, but the portal room wasn't created within 20 seconds. " +
          "The most common cause is that the bot is not a member of that Discord server — " +
          "use 'Add bot to Discord server' on the previous screen to invite it first.",
        );
        setScreen("error");
        return;
      }

      // Optionally send test message
      if (sendTestMsg && testMsg.trim()) {
        await client.sendTextMessage(portal.roomId, testMsg.trim());
      }

      setLinkedRoom(portal);
      setScreen("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setScreen("error");
    }
  }, [client, userId, channelId, sendTestMsg, testMsg]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-surface-container rounded-2xl border border-outline-variant/20 shadow-2xl p-6 max-h-[85vh] flex flex-col">

        {/* ── Browse ── */}
        {screen === "browse" && (
          <>
            <Header title="Discord Bridge" onClose={onClose} />
            <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
              {guildGroups.length === 0 ? (
                /* Empty state: guide the user through the prerequisite steps */
                <div className="space-y-3 py-2">
                  <div className="rounded-xl border border-[#5865F2]/30 bg-[#5865F2]/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#5865F2] text-white text-xs font-bold flex-shrink-0">1</span>
                      <p className="text-sm font-medium text-on-surface">Add the bot to a Discord server</p>
                    </div>
                    <p className="text-xs text-on-surface-variant pl-7">
                      The bridge bot must be a member of the Discord server before it can relay messages.
                    </p>
                    <button
                      onClick={openInviteScreen}
                      className="ml-7 flex items-center gap-1.5 text-xs font-medium text-[#5865F2] hover:text-[#4752c4] transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                      Invite bot to Discord server
                    </button>
                  </div>
                  <div className="rounded-xl border border-outline-variant/20 bg-surface-container-high p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-outline-variant text-on-surface-variant text-xs font-bold flex-shrink-0">2</span>
                      <p className="text-sm font-medium text-on-surface">Link a Discord channel</p>
                    </div>
                    <p className="text-xs text-on-surface-variant pl-7">
                      Once the bot is in your server, link individual channels to create bridged rooms here in Concord.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {guildGroups.map((guild) => (
                    <div key={guild.guildId}>
                      <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5 px-1">
                        {guild.guildName}
                      </p>
                      <div className="space-y-0.5">
                        {guild.channels.map((ch) => (
                          <button
                            key={ch.roomId}
                            onClick={() => navigateTo(ch.roomId)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#5865F2]/10 text-left group transition-colors"
                          >
                            <span className="text-on-surface-variant/60 text-sm group-hover:text-[#5865F2]">#</span>
                            <span className="text-sm text-on-surface group-hover:text-[#5865F2] transition-colors">
                              {ch.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-outline-variant/10 flex-shrink-0 space-y-2">
              <button
                onClick={() => setScreen("link-channel-id")}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors"
              >
                <span className="material-symbols-outlined text-base">add_link</span>
                Link Discord Channel
              </button>
              {/* "Add bot to another server" — secondary action, always visible */}
              <button
                onClick={openInviteScreen}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface text-xs transition-colors"
              >
                <span className="material-symbols-outlined text-sm">person_add</span>
                Add bot to {guildGroups.length > 0 ? "another" : "a"} Discord server
              </button>
            </div>
          </>
        )}

        {/* ── Invite bot ── */}
        {screen === "invite-bot" && (
          <>
            <Header
              title="Add Bot to Discord Server"
              onBack={() => setScreen("browse")}
              onClose={onClose}
            />
            <div className="space-y-4">
              <p className="text-sm text-on-surface-variant">
                The bridge bot must be a member of the Discord server containing the channels you want to link.
              </p>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#5865F2] text-white text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                  <span className="text-on-surface-variant">
                    Click <strong className="text-on-surface">Open Discord Invite</strong> below — Discord will open in a new tab.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#5865F2] text-white text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                  <span className="text-on-surface-variant">
                    Choose which Discord server to add the bot to, then click <strong className="text-on-surface">Authorize</strong>.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#5865F2] text-white text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                  <span className="text-on-surface-variant">
                    Come back here and click <strong className="text-on-surface">Bot is in my server</strong>.
                  </span>
                </li>
              </ol>
              <button
                onClick={() => {
                  if (inviteUrl) {
                    window.open(inviteUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                disabled={inviteUrlLoading || !inviteUrl}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {inviteUrlLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                )}
                Open Discord Invite
              </button>
              <button
                onClick={() => setScreen("link-channel-id")}
                className="w-full py-2.5 rounded-xl border border-outline-variant/30 hover:bg-surface-container-high text-on-surface text-sm font-medium transition-colors"
              >
                Bot is in my server →
              </button>
            </div>
          </>
        )}

        {/* ── Enter channel ID ── */}
        {screen === "link-channel-id" && (
          <>
            <Header
              title="Link Discord Channel"
              onBack={() => setScreen("invite-bot")}
              onClose={onClose}
            />
            <div className="space-y-4">
              <div className="rounded-lg bg-surface-container-high px-4 py-3 text-xs text-on-surface-variant space-y-1.5">
                <p className="font-medium text-on-surface">How to get a channel ID:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Open Discord → User Settings → Advanced → enable <strong>Developer Mode</strong></li>
                  <li>Right-click any channel → <strong>Copy Channel ID</strong></li>
                </ol>
              </div>
              <div>
                <label className="text-xs font-label text-on-surface-variant mb-1.5 block">
                  Discord Channel ID
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value.replace(/\D/g, ""))}
                  placeholder="1234567890123456789"
                  className="w-full px-3 py-2 bg-surface-container-highest rounded-lg text-sm font-mono text-on-surface border border-outline-variant/20 focus:border-[#5865F2]/50 focus:outline-none"
                />
              </div>
              <button
                onClick={() => {
                  if (channelId.trim().length >= 17) setScreen("link-test-msg");
                }}
                disabled={channelId.trim().length < 17}
                className="w-full py-2.5 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* ── Test message ── */}
        {screen === "link-test-msg" && (
          <>
            <Header
              title="Test Message"
              onBack={() => setScreen("link-channel-id")}
              onClose={onClose}
            />
            <div className="space-y-4">
              <p className="text-sm text-on-surface-variant">
                After the bridge connects, optionally send a message to the Discord channel so you can confirm the bot is posting correctly.
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setSendTestMsg((v) => !v)}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                    sendTestMsg ? "bg-[#5865F2]" : "bg-outline-variant"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      sendTestMsg ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </div>
                <span className="text-sm text-on-surface">Send a test message</span>
              </label>
              {sendTestMsg && (
                <div>
                  <label className="text-xs font-label text-on-surface-variant mb-1.5 block">
                    Message text
                  </label>
                  <input
                    type="text"
                    value={testMsg}
                    onChange={(e) => setTestMsg(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container-highest rounded-lg text-sm text-on-surface border border-outline-variant/20 focus:border-[#5865F2]/50 focus:outline-none"
                  />
                </div>
              )}
              <button
                onClick={handleLink}
                className="w-full py-2.5 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded-lg text-sm font-medium transition-colors"
              >
                Link Channel
              </button>
            </div>
          </>
        )}

        {/* ── Linking spinner ── */}
        {screen === "linking" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <span className="inline-block w-8 h-8 border-2 border-outline-variant border-t-[#5865F2] rounded-full animate-spin" />
            <p className="text-sm text-on-surface-variant text-center">
              Sending bridge command…
              <br />
              <span className="text-xs">Waiting for portal room (up to 12s)</span>
            </p>
          </div>
        )}

        {/* ── Done ── */}
        {screen === "done" && (
          <>
            <Header title="Channel Linked!" onClose={onClose} />
            <div className="space-y-4">
              <div className="rounded-lg bg-[#5865F2]/10 border border-[#5865F2]/20 px-4 py-3 flex items-start gap-3">
                <span className="material-symbols-outlined text-[#5865F2] text-xl flex-shrink-0 mt-0.5">check_circle</span>
                <div className="text-sm">
                  <p className="font-medium text-on-surface">
                    {linkedRoom?.name ?? "Portal room created"}
                  </p>
                  {sendTestMsg && (
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      Test message sent — check Discord to confirm the bot posted it.
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-on-surface-variant">
                The channel is now bridged. Messages will sync between Discord and Concord in both directions.
              </p>
              {linkedRoom && (
                <button
                  onClick={() => navigateTo(linkedRoom.roomId)}
                  className="w-full py-2.5 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Open Channel
                </button>
              )}
              <button
                onClick={() => {
                  setScreen("browse");
                  setChannelId("");
                  setLinkedRoom(null);
                }}
                className="w-full py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg text-sm transition-colors"
              >
                Link Another
              </button>
            </div>
          </>
        )}

        {/* ── Error ── */}
        {screen === "error" && (
          <>
            <Header title="Link Failed" onClose={onClose} />
            <div className="space-y-3">
              <div className="rounded-lg bg-error/10 border border-error/20 px-4 py-3">
                <p className="text-sm text-error">{error}</p>
              </div>
              {/* If error looks like a bot-membership issue, offer a direct shortcut */}
              {error.includes("not a member") && (
                <button
                  onClick={openInviteScreen}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <span className="material-symbols-outlined text-base">person_add</span>
                  Add bot to Discord server
                </button>
              )}
              <button
                onClick={() => setScreen("browse")}
                className="w-full py-2.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg text-sm font-medium transition-colors"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
