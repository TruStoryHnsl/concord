import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onEvent } from "@/api/tauri";
import type { Message, PeerInfo, TunnelInfo, VoiceParticipant, VoiceState, DmMessage } from "@/api/tauri";
import { useServersStore, MESH_GENERAL_CHANNEL } from "@/stores/servers";
import { useMeshStore } from "@/stores/mesh";
import { useVoiceStore } from "@/stores/voice";
import { useDmStore } from "@/stores/dm";

export function useNodeEvents() {
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [];

    // Listen for new messages — route to the correct channel
    unlisteners.push(
      onEvent<Message>("concord://new-message", (msg) => {
        const state = useServersStore.getState();

        // If it's a mesh general message and we're on the dashboard (no active server)
        if (
          msg.channelId === MESH_GENERAL_CHANNEL &&
          !state.activeServerId
        ) {
          state.addMessage(msg);
          return;
        }

        // If it's for the currently active channel, add it
        if (msg.channelId === state.activeChannelId) {
          state.addMessage(msg);
          return;
        }

        // Message is for a different channel — store could handle notifications later
        // For now we still add if it's the mesh channel (dashboard uses it)
        if (msg.channelId === MESH_GENERAL_CHANNEL) {
          state.addMessage(msg);
        }
      }),
    );

    // Listen for peer discovery
    unlisteners.push(
      onEvent<PeerInfo>("concord://peer-discovered", (peer) => {
        useMeshStore.getState().addPeer(peer);
      }),
    );

    // Listen for peer departure
    unlisteners.push(
      onEvent<{ peerId: string }>("concord://peer-departed", (peer) => {
        useMeshStore.getState().removePeer(peer.peerId);
      }),
    );

    // Listen for node status changes
    unlisteners.push(
      onEvent<{ connectedPeers: number }>(
        "concord://node-status-changed",
        (status) => {
          useMeshStore.getState().updateConnectionCount(status.connectedPeers);
        },
      ),
    );

    // Tunnel: established
    unlisteners.push(
      onEvent<TunnelInfo>("concord://tunnel-established", (tunnel) => {
        useMeshStore.getState().addTunnel(tunnel);
      }),
    );

    // Tunnel: closed
    unlisteners.push(
      onEvent<{ peerId: string }>("concord://tunnel-closed", ({ peerId }) => {
        useMeshStore.getState().removeTunnel(peerId);
      }),
    );

    // Voice: participant joined
    unlisteners.push(
      onEvent<VoiceParticipant>(
        "concord://voice-participant-joined",
        (participant) => {
          useVoiceStore.getState().addParticipant(participant);
        },
      ),
    );

    // Voice: participant left
    unlisteners.push(
      onEvent<{ peerId: string }>(
        "concord://voice-participant-left",
        ({ peerId }) => {
          useVoiceStore.getState().removeParticipant(peerId);
        },
      ),
    );

    // Voice: full state update
    unlisteners.push(
      onEvent<VoiceState>(
        "concord://voice-state-changed",
        (voiceState) => {
          useVoiceStore.getState().updateState({
            isInVoice: voiceState.isInVoice,
            channelId: voiceState.channelId,
            serverId: voiceState.serverId,
            isMuted: voiceState.isMuted,
            isDeafened: voiceState.isDeafened,
            participants: voiceState.participants,
          });
        },
      ),
    );

    // Trust: attestation received — could refresh trust data
    unlisteners.push(
      onEvent<{ peerId: string }>(
        "concord://attestation-received",
        (_payload) => {
          // Trust data refresh is handled by individual components
          // This event can be used for notifications
        },
      ),
    );

    // DM: incoming message
    unlisteners.push(
      onEvent<DmMessage>(
        "concord://dm-received",
        (message) => {
          useDmStore.getState().addIncomingMessage(message);
        },
      ),
    );

    return () => {
      unlisteners.forEach(async (p) => {
        const unlisten = await p;
        unlisten();
      });
    };
  }, []);
}
