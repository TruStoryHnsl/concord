import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { PassThrough } from "node:stream";

import { Client, GatewayIntentBits } from "discord.js";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import prism from "prism-media";
import {
  AudioFrame,
  AudioMixer,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import {
  PCM_BYTES_PER_FRAME,
  CHANNELS,
  SAMPLE_RATE,
  SAMPLES_PER_CHANNEL,
  DISCORD_VOICE_IDENTITY_PREFIX,
  DISCORD_USER_IDENTITY_PREFIX,
  DISCORD_VIDEO_IDENTITY_PREFIX,
  redact,
  redactDeep,
  structuredLog,
  audioFrameToBuffer,
  bufferToAudioFrame as _bufferToAudioFrame,
  pcmFrames as _pcmFrames,
  selectVideoSource as _selectVideoSource,
} from "./pure.js";

// Bind AudioFrame from @livekit/rtc-node into the pure helpers.
const bufferToAudioFrame = (buf) => _bufferToAudioFrame(buf, AudioFrame);
const pcmFrames = (readable) => _pcmFrames(readable, AudioFrame);
const selectVideoSource = (participants, activeSpeakerId) =>
  _selectVideoSource(
    participants,
    activeSpeakerId,
    TrackSource.SOURCE_SCREEN_SHARE,
    TrackSource.SOURCE_CAMERA,
  );

// =============================================================================
// Resource budget (per container instance)
// =============================================================================
// Memory  : ~40 MB base per active bridge + ~2 MB per concurrent Discord speaker
// CPU     : ~5% per active speaker on a modern single core (Opus decode + PCM pipe)
// Network : ~64 kbps per audio stream (Opus); video relay gated behind
//           VIDEO_INGEST_AVAILABLE=true
// Recommended: max 5 bridges per container instance (stay within 256 MB / 25% CPU)
// =============================================================================

const CONFIG_PATH = process.env.DISCORD_VOICE_ROOMS_FILE || "/config/rooms.json";
const DISCORD_TOKEN_FILE = process.env.DISCORD_BOT_TOKEN_FILE || "";
let discordToken = process.env.DISCORD_BOT_TOKEN || process.env.MAUTRIX_DISCORD_BOT_TOKEN || "";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://livekit:7880";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const HEALTH_PORT = Number(process.env.DISCORD_VOICE_HEALTH_PORT || "3098");
const POLL_MS = Number(process.env.DISCORD_VOICE_CONFIG_POLL_MS || "5000");
const DISCORD_VOICE_IDLE_MS = Number(process.env.DISCORD_VOICE_IDLE_MS || "15000");

// Identity prefixes and audio constants are imported from ./pure.js above.

// @discordjs/voice 0.19.x does not yet expose video track subscription (Discord DAVE
// protocol video is not part of the public JS API). Set this flag to true when the
// library gains that capability and wire up the video path below.
const VIDEO_INGEST_AVAILABLE = false;

const FRAME_MS = 20;

const active = new Map();
let lastConfigHash = "";
let shuttingDown = false;

// Thin log alias used throughout this file.
function log(...args) {
  structuredLog(
    "info",
    String(args[0]),
    ...args.slice(1).map((a) =>
      a instanceof Error ? { error: a.message } : a,
    ),
  );
}

async function requiredEnv() {
  if (!discordToken && DISCORD_TOKEN_FILE) {
    discordToken = (await fs.readFile(DISCORD_TOKEN_FILE, "utf8")).trim();
  }
  const missing = [];
  if (!discordToken) missing.push("DISCORD_BOT_TOKEN, MAUTRIX_DISCORD_BOT_TOKEN, or DISCORD_BOT_TOKEN_FILE");
  if (!LIVEKIT_API_KEY) missing.push("LIVEKIT_API_KEY");
  if (!LIVEKIT_API_SECRET) missing.push("LIVEKIT_API_SECRET");
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const rooms = Array.isArray(parsed.rooms) ? parsed.rooms : [];
    return rooms.filter((room) => room.enabled !== false);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function roomKey(room) {
  return String(room.id ?? `${room.matrix_room_id}:${room.discord_channel_id}`);
}

async function liveKitToken(roomName, identity) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: "Discord Voice",
    ttl: "6h",
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return await token.toJwt();
}

// selectVideoSource, bufferToAudioFrame, audioFrameToBuffer, pcmFrames are
// imported from ./pure.js (wrapped with livekit-specific bindings above).
// See pure.js for policy documentation.

function writeLiveKitMixToDiscord(mixer, output) {
  return (async () => {
    try {
      for await (const frame of mixer) {
        if (!output.writableEnded) output.write(audioFrameToBuffer(frame));
      }
    } catch (error) {
      if (!shuttingDown) log("livekit->discord mixer failed", error);
    } finally {
      output.end();
    }
  })();
}

/**
 * Stream PCM frames from an async generator into a per-user LiveKit AudioSource.
 * Returns a promise that resolves when the generator is exhausted or throws.
 */
async function streamPcmToSource(frameGen, source, bridgeId, userId) {
  try {
    for await (const frame of frameGen) {
      await source.captureFrame(frame);
    }
  } catch (error) {
    if (!shuttingDown) log("discord->livekit per-user stream failed", bridgeId, userId, error);
  }
}

/**
 * Disconnect and clean up a single per-user LiveKit room entry.
 * @param {object} entry  { room, source, track, task }
 * @param {string} bridgeId
 * @param {string} userId
 */
async function cleanupUserVideoRoom(entry, bridgeId, userId) {
  try {
    if (entry.track) {
      await Promise.resolve(entry.room.localParticipant?.unpublishTrack(entry.track)).catch(() => {});
    }
  } catch (error) {
    log("per-user video track unpublish failed", bridgeId, userId, error);
  }
  try {
    await entry.track?.close?.();
  } catch (error) {
    log("per-user video track close failed", bridgeId, userId, error);
  }
  try {
    await entry.room.disconnect();
  } catch (error) {
    log("per-user video room disconnect failed", bridgeId, userId, error);
  }
}

/**
 * Disconnect and clean up a single per-user LiveKit room entry.
 * @param {object} entry  { room, source, track, task }
 * @param {string} bridgeId
 * @param {string} userId
 */
async function cleanupUserRoom(entry, bridgeId, userId) {
  try {
    if (entry.track) {
      await Promise.resolve(entry.room.localParticipant?.unpublishTrack(entry.track)).catch(() => {});
    }
  } catch (error) {
    log("per-user track unpublish failed", bridgeId, userId, error);
  }
  try {
    await entry.source?.close?.();
  } catch (error) {
    log("per-user source close failed", bridgeId, userId, error);
  }
  try {
    await entry.track?.close?.();
  } catch (error) {
    log("per-user track close failed", bridgeId, userId, error);
  }
  try {
    await entry.room.disconnect();
  } catch (error) {
    log("per-user room disconnect failed", bridgeId, userId, error);
  }
}

async function startBridge(client, roomConfig) {
  const mainIdentity = `${DISCORD_VOICE_IDENTITY_PREFIX}${roomConfig.discord_guild_id}:${roomConfig.discord_channel_id}`;
  const bridgeId = roomKey(roomConfig);
  log("starting voice bridge", bridgeId, roomConfig.matrix_room_id, roomConfig.discord_channel_id);

  const channel = await client.channels.fetch(roomConfig.discord_channel_id);
  if (!channel?.isVoiceBased?.()) {
    throw new Error(`Discord channel ${roomConfig.discord_channel_id} is not a voice channel`);
  }

  // Main room: used for the inbound path (LK→Discord) and as the subscriber
  // that monitors participant events. Does NOT publish any audio tracks itself
  // after W1 — outbound audio is published by per-user rooms below.
  const lkRoom = new Room();
  const mainToken = await liveKitToken(roomConfig.matrix_room_id, mainIdentity);
  await lkRoom.connect(LIVEKIT_URL, mainToken, { autoSubscribe: true });

  // Per-Discord-user LK room connections for outbound audio (Discord→LK).
  // Key: Discord userId
  // Value: { room, source, track, task }
  const discordUserRooms = new Map();

  // Per-Discord-user LK room connections for outbound video (Discord→LK).
  // Key: Discord userId
  // Value: { room, track }
  // Populated only when roomConfig.video_enabled is true AND VIDEO_INGEST_AVAILABLE is true.
  const discordVideoRooms = new Map();

  // Warn once if video is requested but the Discord JS library doesn't support it yet.
  if (roomConfig.video_enabled && !VIDEO_INGEST_AVAILABLE) {
    log(
      "video_enabled=true but VIDEO_INGEST_AVAILABLE=false for bridge", bridgeId,
      "— @discordjs/voice does not yet expose DAVE video track subscription.",
      "Set VIDEO_INGEST_AVAILABLE=true when the library gains that capability.",
    );
  }

  let discordConnection = null;
  let discordPlayer = null;
  let discordAudioOut = null;
  let liveKitToDiscordMixer = null;
  let tasks = [];
  let idleTimer = null;
  let onDiscordSpeaking = null;
  const liveKitStreams = new Map();
  const subscribedLiveKitTracks = new Map();

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const nonBridgeParticipantCount = () =>
    [...lkRoom.remoteParticipants.values()].filter(
      (participant) => !participant.identity.startsWith(DISCORD_VOICE_IDENTITY_PREFIX) &&
                       !participant.identity.startsWith(DISCORD_USER_IDENTITY_PREFIX) &&
                       !participant.identity.startsWith(DISCORD_VIDEO_IDENTITY_PREFIX),
    ).length;

  const removeLiveKitStream = (key) => {
    const stream = liveKitStreams.get(key);
    if (!stream || !liveKitToDiscordMixer) return;
    liveKitStreams.delete(key);
    liveKitToDiscordMixer.removeStream(stream);
  };

  const addLiveKitTrackToMixer = (key, remoteTrack) => {
    if (!liveKitToDiscordMixer || liveKitStreams.has(key)) return;
    const stream = new AudioStream(remoteTrack, {
      sampleRate: SAMPLE_RATE,
      numChannels: CHANNELS,
      frameSizeMs: FRAME_MS,
    });
    liveKitStreams.set(key, stream);
    liveKitToDiscordMixer.addStream(stream);
  };

  const disconnectDiscord = async (reason = "idle") => {
    clearIdleTimer();
    if (
      !discordConnection &&
      !discordPlayer &&
      !discordAudioOut &&
      !liveKitToDiscordMixer
    ) {
      return;
    }
    log("disconnecting discord voice", bridgeId, reason);

    // Disconnect all per-user LK rooms first.
    for (const [userId, entry] of discordUserRooms.entries()) {
      await cleanupUserRoom(entry, bridgeId, userId).catch((error) =>
        log("per-user cleanup failed", bridgeId, userId, error),
      );
    }
    discordUserRooms.clear();

    // Disconnect per-user video rooms.
    for (const [userId, entry] of discordVideoRooms.entries()) {
      await cleanupUserVideoRoom(entry, bridgeId, userId).catch((error) =>
        log("per-user video cleanup failed", bridgeId, userId, error),
      );
    }
    discordVideoRooms.clear();

    if (discordConnection && onDiscordSpeaking) {
      discordConnection.receiver.speaking.off("start", onDiscordSpeaking);
    }
    for (const key of liveKitStreams.keys()) {
      removeLiveKitStream(key);
    }
    liveKitToDiscordMixer?.endInput();
    if (discordAudioOut && !discordAudioOut.writableEnded) {
      discordAudioOut.end();
    }
    try {
      discordPlayer?.stop(true);
    } catch (error) {
      log("discord player stop failed", bridgeId, error);
    }
    try {
      if (discordConnection?.state?.status !== VoiceConnectionStatus.Destroyed) {
        discordConnection?.destroy();
      }
    } catch (error) {
      log("discord connection destroy failed", bridgeId, error);
    }
    await Promise.allSettled(tasks);
    tasks = [];
    await liveKitToDiscordMixer?.aclose?.();
    discordConnection = null;
    discordPlayer = null;
    discordAudioOut = null;
    liveKitToDiscordMixer = null;
    onDiscordSpeaking = null;
  };

  const ensureDiscordConnected = async () => {
    clearIdleTimer();
    if (discordConnection || shuttingDown) return;
    log("connecting discord voice", bridgeId);
    discordConnection = joinVoiceChannel({
      channelId: roomConfig.discord_channel_id,
      guildId: roomConfig.discord_guild_id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    discordConnection.on("error", (error) => log("discord voice error", bridgeId, error));
    await entersState(discordConnection, VoiceConnectionStatus.Ready, 30_000);

    // Inbound mixer: LK remote tracks → Discord audio player (unchanged from W0).
    liveKitToDiscordMixer = new AudioMixer(SAMPLE_RATE, CHANNELS, {
      blocksize: SAMPLES_PER_CHANNEL,
      streamTimeoutMs: 100,
    });

    discordAudioOut = new PassThrough({ highWaterMark: PCM_BYTES_PER_FRAME * 10 });
    discordPlayer = createAudioPlayer();
    const resource = createAudioResource(discordAudioOut, { inputType: StreamType.Raw });
    discordPlayer.on("error", (error) => log("discord audio player error", bridgeId, error));
    discordPlayer.on(AudioPlayerStatus.Idle, () => {
      if (!shuttingDown) log("discord audio player idle", bridgeId);
    });
    discordConnection.subscribe(discordPlayer);
    discordPlayer.play(resource);

    tasks = [writeLiveKitMixToDiscord(liveKitToDiscordMixer, discordAudioOut)];

    // Per-user speaking handler: each Discord speaker gets their own LK room
    // connection and publishes their audio track under their own identity.
    onDiscordSpeaking = (userId) => {
      if (userId === client.user?.id || discordUserRooms.has(userId) || !discordConnection) return;

      const opus = discordConnection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });
      const decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: SAMPLES_PER_CHANNEL,
      });
      const pcm = opus.pipe(decoder);
      const frameGen = pcmFrames(pcm);

      const userIdentity = `${DISCORD_USER_IDENTITY_PREFIX}${roomConfig.discord_guild_id}:${userId}`;

      // Open a per-user LK room and publish their audio track.
      (async () => {
        let userRoom, userSource, userTrack;
        try {
          userRoom = new Room();
          const userToken = await liveKitToken(roomConfig.matrix_room_id, userIdentity);
          await userRoom.connect(LIVEKIT_URL, userToken, { autoSubscribe: false });

          userSource = new AudioSource(SAMPLE_RATE, CHANNELS);
          userTrack = LocalAudioTrack.createAudioTrack("discord-audio", userSource);
          const opts = new TrackPublishOptions();
          opts.source = TrackSource.SOURCE_MICROPHONE;
          await userRoom.localParticipant.publishTrack(userTrack, opts);

          const entry = { room: userRoom, source: userSource, track: userTrack };
          discordUserRooms.set(userId, entry);

          log("per-user LK track published", bridgeId, userIdentity);

          // W3: Outbound video projection — select and relay the best LiveKit
          // video source to Discord. Gated on video_enabled AND VIDEO_INGEST_AVAILABLE.
          // When @discordjs/voice gains DAVE video subscription support, implement:
          //   1. Call selectVideoSource(lkRoom.remoteParticipants.values(), activeSpeakerId)
          //   2. Open a per-user video LK room: discord-video:<guild>:<userId>
          //   3. Publish LocalVideoTrack with TrackSource matching policy result
          //   4. Track in discordVideoRooms; clean up in finally block below
          if (roomConfig.video_enabled === true && VIDEO_INGEST_AVAILABLE) {
            const activeSpeakerId = lkRoom.activeSpeakers?.[0]?.identity ?? null;
            const videoResult = selectVideoSource(
              lkRoom.remoteParticipants.values(),
              activeSpeakerId,
            );
            if (videoResult) {
              log("video projection: selected source", bridgeId, { source: videoResult.source });
            } else {
              log("video projection: no source available", bridgeId);
            }
            // Future: open discordVideoRooms entry and publish videoResult.track
          }

          // Stream PCM until the discord opus stream ends.
          await streamPcmToSource(frameGen, userSource, bridgeId, userId);
        } catch (error) {
          if (!shuttingDown) log("per-user LK room setup failed", bridgeId, userIdentity, error);
        } finally {
          // Cleanup when speaking stops.
          if (discordUserRooms.has(userId)) {
            discordUserRooms.delete(userId);
          }
          if (userRoom) {
            await cleanupUserRoom(
              { room: userRoom, source: userSource, track: userTrack },
              bridgeId,
              userId,
            ).catch(() => {});
          }
          log("per-user LK track removed", bridgeId, userIdentity);
        }
      })();

      pcm.once("error", (error) => {
        log("discord receive decode error", bridgeId, userId, error);
      });
    };

    discordConnection.receiver.speaking.on("start", onDiscordSpeaking);
    for (const [key, remoteTrack] of subscribedLiveKitTracks.entries()) {
      addLiveKitTrackToMixer(key, remoteTrack);
    }
  };

  const scheduleIdleDisconnect = () => {
    clearIdleTimer();
    if (!discordConnection) return;
    idleTimer = setTimeout(() => {
      disconnectDiscord("no-local-participants").catch((error) =>
        log("idle disconnect failed", bridgeId, error),
      );
    }, DISCORD_VOICE_IDLE_MS);
  };

  const onTrackSubscribed = (remoteTrack, _publication, participant) => {
    if (participant.identity === mainIdentity) return;
    if (!(remoteTrack instanceof RemoteAudioTrack)) return;
    // Don't loop back per-user synthetic audio or video tracks into Discord.
    if (participant.identity.startsWith(DISCORD_USER_IDENTITY_PREFIX)) return;
    if (participant.identity.startsWith(DISCORD_VIDEO_IDENTITY_PREFIX)) return;
    const key = `${participant.identity}:${remoteTrack.sid ?? remoteTrack.name ?? Date.now()}`;
    subscribedLiveKitTracks.set(key, remoteTrack);
    if (!participant.identity.startsWith(DISCORD_VOICE_IDENTITY_PREFIX)) {
      clearIdleTimer();
      ensureDiscordConnected().catch((error) =>
        log("discord connect failed", bridgeId, error),
      );
    }
    addLiveKitTrackToMixer(key, remoteTrack);
  };

  const onTrackUnsubscribed = (remoteTrack, _publication, participant) => {
    const prefix = `${participant.identity}:`;
    for (const key of [...subscribedLiveKitTracks.keys()]) {
      if (!key.startsWith(prefix)) continue;
      if (remoteTrack.sid && !key.includes(remoteTrack.sid)) continue;
      subscribedLiveKitTracks.delete(key);
      removeLiveKitStream(key);
    }
    if (nonBridgeParticipantCount() === 0) {
      scheduleIdleDisconnect();
    }
  };

  const onParticipantConnected = (participant) => {
    if (participant.identity.startsWith(DISCORD_VOICE_IDENTITY_PREFIX)) return;
    if (participant.identity.startsWith(DISCORD_USER_IDENTITY_PREFIX)) return;
    clearIdleTimer();
    ensureDiscordConnected().catch((error) =>
      log("discord connect failed", bridgeId, error),
    );
  };

  const onParticipantDisconnected = (participant) => {
    if (participant.identity.startsWith(DISCORD_VOICE_IDENTITY_PREFIX)) return;
    if (participant.identity.startsWith(DISCORD_USER_IDENTITY_PREFIX)) return;
    if (nonBridgeParticipantCount() === 0) {
      scheduleIdleDisconnect();
    }
  };

  lkRoom
    .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    .on(RoomEvent.ParticipantConnected, onParticipantConnected)
    .on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    .on(RoomEvent.Disconnected, () => log("livekit room disconnected", bridgeId));

  if (nonBridgeParticipantCount() > 0) {
    await ensureDiscordConnected();
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    log("stopping voice bridge", bridgeId);
    lkRoom.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    lkRoom.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    lkRoom.off(RoomEvent.ParticipantConnected, onParticipantConnected);
    lkRoom.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    await disconnectDiscord("shutdown");
    try {
      await lkRoom.disconnect();
    } catch (error) {
      log("livekit disconnect failed", bridgeId, error);
    }
  };

  return {
    stop,
    roomConfig,
    getStatus: async () => {
      const liveChannel = client.channels.cache.get(roomConfig.discord_channel_id) ?? channel;
      const discordMembers = liveChannel?.isVoiceBased?.()
        ? [...liveChannel.members.values()]
            .filter((member) => !member.user?.bot)
            .map((member) => ({
              id: member.user.id,
              name: member.displayName ?? member.user.globalName ?? member.user.username,
            }))
        : [];
      return {
        id: bridgeId,
        matrix_room_id: roomConfig.matrix_room_id,
        discord_guild_id: roomConfig.discord_guild_id,
        discord_channel_id: roomConfig.discord_channel_id,
        connected: Boolean(discordConnection),
        // W1: each active Discord speaker is a separate LK participant.
        active_user_participants: discordUserRooms.size,
        // W2: each active Discord video stream is a separate LK participant.
        active_video_participants: discordVideoRooms.size,
        video_enabled: Boolean(roomConfig.video_enabled),
        discord_members: discordMembers,
      };
    },
  };
}

async function reconcile(client) {
  const rooms = await readConfig();
  const hash = JSON.stringify(rooms);
  if (hash === lastConfigHash) return;
  lastConfigHash = hash;

  const desired = new Map(rooms.map((room) => [roomKey(room), room]));

  for (const [key, bridge] of active.entries()) {
    const next = desired.get(key);
    if (!next || JSON.stringify(next) !== JSON.stringify(bridge.roomConfig)) {
      await bridge.stop().catch((error) => log("stop failed", key, error));
      active.delete(key);
    }
  }

  for (const [key, room] of desired.entries()) {
    if (active.has(key)) continue;
    try {
      active.set(key, await startBridge(client, room));
    } catch (error) {
      log("failed to start voice bridge", key, error);
    }
  }
}

function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    // /ready — readiness probe (503 while shutting down)
    if (req.url === "/ready") {
      if (shuttingDown) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, ready: false }));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ready: true }));
      }
      return;
    }

    // /health (default) — detailed status
    try {
      const rooms = await Promise.all(
        [...active.values()].map((bridge) => bridge.getStatus()),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, active_bridges: active.size, rooms }));
    } catch (error) {
      log("health status failed", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, active_bridges: active.size, rooms: [] }));
    }
  });
  server.listen(HEALTH_PORT, "0.0.0.0", () => {
    log(`health server listening on ${HEALTH_PORT}`);
  });
  return server;
}

async function main() {
  await requiredEnv();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  client.on("error", (error) => log("discord client error", error));
  await client.login(discordToken);
  log("discord voice bot logged in as", client.user?.tag ?? client.user?.id);

  const health = startHealthServer();
  await reconcile(client);
  const interval = setInterval(() => {
    reconcile(client).catch((error) => log("config reconcile failed", error));
  }, POLL_MS);

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    health.close();
    for (const [key, bridge] of active.entries()) {
      await bridge.stop().catch((error) => log("stop failed", key, error));
      active.delete(key);
    }
    client.destroy();
    await dispose();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Unit tests import from ./pure.js directly — no exports needed here.
