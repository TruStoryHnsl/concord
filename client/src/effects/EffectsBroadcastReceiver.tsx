// EffectsBroadcastReceiver — listens for inbound effect data packets on
// the LiveKit room and fires the named visual locally via the effects
// store. Renders nothing.
//
// Mounted INSIDE the <LiveKitRoom> provider tree (see VoiceRoomLayer) so
// it has room context. The matching *send* side is `broadcastEffect()`,
// called from SoundboardPanel when the local user fires an effect. The
// paired sound already reaches peers via the published "soundboard" audio
// track, so this packet carries only the visual descriptor.

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import type { RemoteParticipant } from "livekit-client";
import { decodeEffectPacket, EFFECTS_DATA_TOPIC } from "./broadcast";
import { fireEffect } from "./store";

export function EffectsBroadcastReceiver() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      // Only handle our own topic; ignore any other data-channel traffic.
      if (topic && topic !== EFFECTS_DATA_TOPIC) return;
      const meta = decodeEffectPacket(payload);
      if (!meta) return;
      // origin = sender identity so the overlay could attribute it later.
      fireEffect(meta, { origin: participant?.identity ?? "remote" });
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  return null;
}
