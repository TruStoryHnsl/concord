import { useState, useCallback } from "react";
import {
  useParticipants,
  useLocalParticipant,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import { Track, ConnectionState } from "livekit-client";
import "@livekit/components-styles";
import { getVoiceToken } from "../../api/livekit";
import { useAuthStore } from "../../stores/auth";
import { useSettingsStore } from "../../stores/settings";
import { useVoiceStore } from "../../stores/voice";
import { useServerStore } from "../../stores/server";
import { useDisplayName } from "../../hooks/useDisplayName";
import { useVoiceNotifications } from "../../hooks/useVoiceNotifications";
import { useMutedSpeaking } from "../../hooks/useMutedSpeaking";
import { useToastStore } from "../../stores/toast";
import { updateDisplayName } from "../../api/concorrd";
import { SoundboardPanel } from "./SoundboardPanel";
import { Avatar } from "../ui/Avatar";

interface VoiceChannelProps {
  roomId: string;
  channelName: string;
  serverId: string;
}

export function VoiceChannel({ roomId, channelName, serverId }: VoiceChannelProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const echoCancellation = useSettingsStore((s) => s.echoCancellation);
  const noiseSuppression = useSettingsStore((s) => s.noiseSuppression);
  const autoGainControl = useSettingsStore((s) => s.autoGainControl);
  const preferredInputDeviceId = useSettingsStore((s) => s.preferredInputDeviceId);
  const voiceConnected = useVoiceStore((s) => s.connected);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const connect = useVoiceStore((s) => s.connect);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    if (!accessToken) return;
    setConnecting(true);
    setError(null);
    try {
      // Request mic permission IMMEDIATELY during user gesture (critical for mobile)
      let micGranted = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation,
            noiseSuppression,
            autoGainControl,
            ...(preferredInputDeviceId && { deviceId: { ideal: preferredInputDeviceId } }),
          },
        });
        stream.getTracks().forEach((t) => t.stop());
        micGranted = true;
      } catch {
        // Continue without mic
      }

      // Resume AudioContext for mobile playback
      let ctx: AudioContext | null = null;
      try {
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
      } catch {
        // Non-critical
      } finally {
        ctx?.close();
      }

      const result = await getVoiceToken(roomId, accessToken);
      const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
      const port = window.location.port ? `:${window.location.port}` : "";
      const clientUrl = `${wsProto}://${window.location.hostname}${port}/livekit/`;

      connect({
        token: result.token,
        livekitUrl: clientUrl,
        iceServers: result.ice_servers?.length ? result.ice_servers : [],
        serverId,
        channelId: roomId,
        channelName,
        roomName: roomId,
        micGranted,
      });
    } catch (err) {
      console.error("Failed to join voice:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }, [roomId, accessToken, echoCancellation, noiseSuppression, autoGainControl, preferredInputDeviceId, serverId, channelName, connect]);

  // Show join screen if not connected to THIS channel
  if (!voiceConnected || voiceChannelId !== roomId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-zinc-400">Voice Channel: #{channelName}</p>
        {voiceConnected && voiceChannelId !== roomId && (
          <p className="text-yellow-400 text-sm">
            Already connected to another voice channel. Leave first.
          </p>
        )}
        <button
          onClick={handleJoin}
          disabled={connecting || (voiceConnected && voiceChannelId !== roomId)}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white font-medium rounded-lg transition-colors"
        >
          {connecting ? "Connecting..." : "Join Voice"}
        </button>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    );
  }

  // Connected to this channel — show the room UI
  // LiveKitRoom is provided by App.tsx, so we can use LiveKit hooks directly
  return <VoiceRoomUI channelName={channelName} serverId={serverId} />;
}

function VoiceRoomUI({
  channelName,
  serverId,
}: {
  channelName: string;
  serverId: string;
}) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const tracks = useTracks([Track.Source.Microphone]);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const [micError, setMicError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const echoCancellation = useSettingsStore((s) => s.echoCancellation);
  const noiseSuppression = useSettingsStore((s) => s.noiseSuppression);
  const autoGainControl = useSettingsStore((s) => s.autoGainControl);
  const userVolumes = useSettingsStore((s) => s.userVolumes);
  const setUserVolume = useSettingsStore((s) => s.setUserVolume);
  const masterOutputVolume = useSettingsStore((s) => s.masterOutputVolume);
  const userMuted = useSettingsStore((s) => s.userMuted);
  const toggleUserMuted = useSettingsStore((s) => s.toggleUserMuted);

  // Play join/leave sounds
  useVoiceNotifications(participants, localParticipant.identity, masterOutputVolume);

  const isMicEnabled = localParticipant.isMicrophoneEnabled;
  const preferredInputDeviceId = useSettingsStore((s) => s.preferredInputDeviceId);

  // Detect speaking while self-muted (local-only reminder)
  const isMutedSpeaking = useMutedSpeaking(isMicEnabled, preferredInputDeviceId ?? undefined);

  const toggleMic = useCallback(async () => {
    setMicError(null);
    try {
      if (!isMicEnabled) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation,
              noiseSuppression,
              autoGainControl,
              ...(preferredInputDeviceId && { deviceId: { ideal: preferredInputDeviceId } }),
            },
          });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // Permission already granted or will be handled by LiveKit
        }
      }
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
    } catch (err) {
      console.error("Mic toggle failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setMicError(
          window.isSecureContext
            ? "Microphone permission denied. Check browser settings."
            : "Microphone requires HTTPS. Access via localhost or enable SSL.",
        );
      } else {
        setMicError(msg);
      }
    }
  }, [localParticipant, isMicEnabled, echoCancellation, noiseSuppression, autoGainControl, preferredInputDeviceId]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-zinc-700 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ConnectionIndicator state={connectionState} />
            <span className="text-zinc-500 text-sm">#{channelName}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMic}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                isMicEnabled
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  : "bg-red-600/20 hover:bg-red-600/30 text-red-400"
              }`}
            >
              {isMicEnabled ? "Mute" : "Unmute"}
            </button>
            <button
              onClick={() => openSettings("audio")}
              className="px-3 py-1.5 text-sm rounded-md transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              title="Audio Settings"
            >
              Settings
            </button>
            <button
              onClick={disconnect}
              className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-sm rounded-md transition-colors"
            >
              Leave
            </button>
          </div>
        </div>
        {micError && (
          <p className="text-red-400 text-xs mt-2">{micError}</p>
        )}
        {!window.isSecureContext && (
          <p className="text-yellow-500 text-xs mt-2">
            Not a secure context — microphone access may be blocked.
            Use https:// or localhost.
          </p>
        )}
      </div>

      {/* Participant list */}
      <div className="flex-1 p-4 overflow-y-auto min-h-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {participants.map((p) => {
            const isSelf = p.identity === localParticipant.identity;
            const isMuted = !p.isMicrophoneEnabled;
            const hasAudioTrack = tracks.some(
              (t) =>
                t.participant.identity === p.identity &&
                t.source === Track.Source.Microphone,
            );
            const isUserMuted = !isSelf && !!userMuted[p.identity];
            // Red glow when local user speaks into a muted mic
            const showMutedSpeaking = isSelf && isMutedSpeaking;

            // Tile background: green for speaking, red for muted-speaking, desaturated red for user-muted
            const tileBg = showMutedSpeaking
              ? "bg-red-900/30"
              : p.isSpeaking && !isUserMuted
                ? "bg-emerald-900/30"
                : isUserMuted
                  ? "bg-red-950/40"
                  : "bg-zinc-800/50";

            // Avatar ring: green for speaking, red for muted-speaking
            const ringClass = showMutedSpeaking
              ? "ring-2 ring-red-500/60"
              : p.isSpeaking && !isUserMuted
                ? "ring-2 ring-emerald-500/50"
                : "";

            return (
              <div
                key={p.identity}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${tileBg} ${
                  isUserMuted ? "opacity-60" : ""
                }`}
              >
                {/* Red overlay stripe for user-muted */}
                {isUserMuted && (
                  <div className="absolute inset-0 rounded-xl border border-red-500/30 pointer-events-none" />
                )}
                {/* Avatar with speaking/muted-speaking ring */}
                <div className={`relative rounded-full transition-all ${ringClass}`}>
                  <Avatar userId={p.identity} size="lg" />
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-zinc-900 ${
                      isMuted
                        ? "bg-red-500"
                        : hasAudioTrack
                          ? "bg-emerald-500"
                          : "bg-yellow-500"
                    }`}
                    title={
                      isMuted
                        ? "Muted"
                        : hasAudioTrack
                          ? "Audio active"
                          : "No audio track"
                    }
                  />
                </div>
                {/* Name + status */}
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <ParticipantNameLabel
                      userId={p.identity}
                      isSelf={isSelf}
                      serverId={serverId}
                      onClick={() =>
                        !isSelf &&
                        setExpandedUser(expandedUser === p.identity ? null : p.identity)
                      }
                    />
                    {!isSelf && (
                      <button
                        onClick={() => toggleUserMuted(p.identity)}
                        className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                          userMuted[p.identity]
                            ? "text-red-400 hover:text-red-300"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                        title={userMuted[p.identity] ? "Unmute user" : "Mute user"}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {userMuted[p.identity] ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-2.536a5 5 0 010-7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          )}
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {isUserMuted
                      ? "Muted by you"
                      : showMutedSpeaking
                        ? "Muted"
                        : isMuted
                          ? "Muted"
                          : p.isSpeaking
                            ? "Speaking"
                            : "Listening"}
                  </p>
                </div>
                {/* Per-user volume slider (remote participants only, click name to toggle) */}
                {!isSelf && expandedUser === p.identity && (
                  <div className="w-full mt-1 flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-zinc-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={userVolumes[p.identity] ?? 1.0}
                      onChange={(e) => setUserVolume(p.identity, parseFloat(e.target.value))}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer bg-zinc-700
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5
                        [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full
                        [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm
                        [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5
                        [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
                        [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-sm"
                      style={{
                        background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${((userVolumes[p.identity] ?? 1.0) / 2) * 100}%, #3f3f46 ${((userVolumes[p.identity] ?? 1.0) / 2) * 100}%, #3f3f46 100%)`,
                      }}
                      title={`${Math.round((userVolumes[p.identity] ?? 1.0) * 100)}%`}
                    />
                    <span className="text-[10px] text-zinc-500 tabular-nums w-7 text-right flex-shrink-0">
                      {Math.round((userVolumes[p.identity] ?? 1.0) * 100)}%
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Soundboard */}
      <SoundboardPanel
        serverId={serverId}
        localParticipant={localParticipant}
      />
    </div>
  );
}

function ParticipantNameLabel({
  userId,
  isSelf,
  serverId,
  onClick,
}: {
  userId: string;
  isSelf: boolean;
  serverId: string;
  onClick?: () => void;
}) {
  const displayName = useDisplayName(userId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const loadMembers = useServerStore((s) => s.loadMembers);
  const addToast = useToastStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayName);

  const handleDoubleClick = () => {
    if (!isSelf) return;
    setEditValue(displayName);
    setEditing(true);
  };

  const handleSave = async () => {
    setEditing(false);
    if (!accessToken) return;
    const newName = editValue.trim() || null;
    try {
      await updateDisplayName(serverId, userId, newName, accessToken);
      await loadMembers(serverId, accessToken);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to update name");
    }
  };

  if (editing) {
    return (
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
        maxLength={32}
        className="text-sm text-white bg-zinc-700 border border-indigo-500 rounded px-1.5 py-0.5 text-center w-24 focus:outline-none"
      />
    );
  }

  return (
    <span
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      className={`text-sm ${isSelf ? "cursor-default" : "hover:text-white cursor-pointer"} text-zinc-200`}
      title={isSelf ? "Double-click to edit display name" : "Click to adjust volume"}
    >
      {displayName}
      {isSelf && (
        <span className="text-zinc-500 text-xs ml-1">(you)</span>
      )}
    </span>
  );
}

function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const config: Record<string, { color: string; label: string }> = {
    [ConnectionState.Connected]: { color: "bg-emerald-500", label: "Connected" },
    [ConnectionState.Connecting]: { color: "bg-yellow-500", label: "Connecting" },
    [ConnectionState.Reconnecting]: { color: "bg-yellow-500", label: "Reconnecting" },
    [ConnectionState.Disconnected]: { color: "bg-red-500", label: "Disconnected" },
  };
  const { color, label } = config[state] ?? { color: "bg-zinc-500", label: state };

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span
        className={`text-sm font-medium ${
          state === ConnectionState.Connected
            ? "text-emerald-400"
            : "text-zinc-400"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
