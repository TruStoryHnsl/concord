import { useEffect, useRef, useCallback } from "react";
import { useTracks } from "@livekit/components-react";
import { Track, RemoteTrack } from "livekit-client";
import { useSettingsStore } from "../../stores/settings";

/**
 * Audio playback for remote participants.
 *
 * Two-tier architecture with graceful fallback:
 *
 * Tier 1 (always active): track.attach() → <audio> element in DOM.
 *   Browser-native path identical to LiveKit's own RoomAudioRenderer.
 *   Reliable on all browsers. Volume via audioEl.volume (capped 0–1).
 *
 * Tier 2 (enhancement): Web Audio API chain for volume boost >100%
 *   and DynamicsCompressor normalization. Only active when AudioContext
 *   is "running". Falls back to Tier 1 automatically on suspend.
 */

interface AudioElementWithSinkId extends HTMLAudioElement {
  setSinkId(sinkId: string): Promise<void>;
}

interface WebAudioNodes {
  source: MediaStreamAudioSourceNode;
  compressor: DynamicsCompressorNode;
  makeupGainNode: GainNode;
  userGain: GainNode;
  sinkEl: HTMLAudioElement;
  mediaStreamDest: MediaStreamAudioDestinationNode;
  clonedTrack: MediaStreamTrack;
}

interface ParticipantChain {
  audioEl: HTMLAudioElement;
  remoteTrack: RemoteTrack;
  identity: string;
  isSoundboard: boolean;
  webAudio: WebAudioNodes | null;
}

/** Try to start playback; swallow autoplay errors (retried on user gesture). */
function safePlay(el: HTMLAudioElement): void {
  const p = el.play();
  if (p) p.catch(() => {});
}

function destroyWebAudio(wa: WebAudioNodes) {
  wa.source.disconnect();
  wa.compressor.disconnect();
  wa.makeupGainNode.disconnect();
  wa.userGain.disconnect();
  wa.mediaStreamDest.disconnect();
  wa.sinkEl.pause();
  wa.sinkEl.srcObject = null;
  wa.sinkEl.remove();
  wa.clonedTrack.stop();
}

function destroyChain(chain: ParticipantChain) {
  if (chain.webAudio) destroyWebAudio(chain.webAudio);
  chain.remoteTrack.detach(chain.audioEl);
  chain.audioEl.remove();
}

export function CustomAudioRenderer() {
  const chainsRef = useRef<Map<string, ParticipantChain>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  const trackRefs = useTracks([Track.Source.Microphone, Track.Source.Unknown], {
    onlySubscribed: true,
  });

  const masterOutputVolume = useSettingsStore((s) => s.masterOutputVolume);
  const normalizationEnabled = useSettingsStore((s) => s.normalizationEnabled);
  const compressorThreshold = useSettingsStore((s) => s.compressorThreshold);
  const compressorKnee = useSettingsStore((s) => s.compressorKnee);
  const compressorRatio = useSettingsStore((s) => s.compressorRatio);
  const compressorAttack = useSettingsStore((s) => s.compressorAttack);
  const compressorRelease = useSettingsStore((s) => s.compressorRelease);
  const makeupGain = useSettingsStore((s) => s.makeupGain);
  const soundboardVolume = useSettingsStore((s) => s.soundboardVolume);
  const userVolumes = useSettingsStore((s) => s.userVolumes);
  const userMuted = useSettingsStore((s) => s.userMuted);
  const preferredOutputDeviceId = useSettingsStore(
    (s) => s.preferredOutputDeviceId,
  );

  // All settings in a ref so non-reactive contexts (event handlers,
  // AudioContext statechange) always read fresh values.
  const settingsRef = useRef({
    normalizationEnabled,
    compressorThreshold,
    compressorKnee,
    compressorRatio,
    compressorAttack,
    compressorRelease,
    makeupGain,
    soundboardVolume,
    userVolumes,
    userMuted,
    masterOutputVolume,
    preferredOutputDeviceId,
  });
  settingsRef.current = {
    normalizationEnabled,
    compressorThreshold,
    compressorKnee,
    compressorRatio,
    compressorAttack,
    compressorRelease,
    makeupGain,
    soundboardVolume,
    userVolumes,
    userMuted,
    masterOutputVolume,
    preferredOutputDeviceId,
  };

  // Apply volume to a single chain. Reads from settingsRef for fresh values.
  // Chooses Tier 1 (element) or Tier 2 (Web Audio) based on AudioContext state.
  const applyVolumeToChain = useCallback((chain: ParticipantChain) => {
    const s = settingsRef.current;
    const identity = chain.identity;
    const muted = !!s.userMuted[identity];
    const userVol = s.userVolumes[identity] ?? 1.0;
    // Apply soundboard volume multiplier for remote soundboard tracks
    const sbMul = chain.isSoundboard ? s.soundboardVolume : 1.0;
    const effectiveVol = muted ? 0 : userVol * s.masterOutputVolume * sbMul;

    // Keep cloned track's enabled state in sync with original (deafen support)
    if (chain.webAudio) {
      chain.webAudio.clonedTrack.enabled = chain.remoteTrack.mediaStreamTrack.enabled;
    }

    if (chain.webAudio && audioCtxRef.current?.state === "running") {
      // Tier 2 active: Web Audio handles playback via cloned track
      chain.audioEl.volume = 0;
      chain.webAudio.userGain.gain.value = muted ? 0 : userVol * sbMul;
    } else {
      // Tier 1: native element (clamped 0–1)
      chain.audioEl.volume = Math.min(1, Math.max(0, effectiveVol));
      // Ensure element is actually playing (may have been blocked by autoplay)
      if (chain.audioEl.paused) safePlay(chain.audioEl);
    }
  }, []); // Stable — reads from refs

  // Apply volume to all chains
  const applyAllVolumes = useCallback(() => {
    for (const chain of chainsRef.current.values()) {
      applyVolumeToChain(chain);
    }
  }, [applyVolumeToChain]);

  // Create or get AudioContext. Stable callback (no reactive deps).
  const getOrCreateCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        masterGainRef.current = ctx.createGain();
        masterGainRef.current.gain.value =
          settingsRef.current.masterOutputVolume;
        masterGainRef.current.connect(ctx.destination);

        // When AudioContext suspends/resumes, switch between Tier 1 and Tier 2.
        // Uses refs — always reads fresh settings and chains.
        ctx.addEventListener("statechange", () => {
          applyAllVolumes();
        });
      } catch {
        return null;
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }, [applyAllVolumes]); // applyAllVolumes is stable (reads from refs)

  // Build Web Audio nodes for a participant (Tier 2 enhancement).
  // Returns null if AudioContext isn't available.
  const createWebAudioNodes = useCallback(
    (track: RemoteTrack, identity: string): WebAudioNodes | null => {
      const ctx = getOrCreateCtx();
      if (!ctx || !masterGainRef.current) return null;

      const s = settingsRef.current;
      try {
        // Clone the track so Web Audio and the native <audio> element don't
        // compete for the same MediaStreamTrack. Chrome has a known issue where
        // dual consumers of one track causes intermittent silent output.
        const clonedTrack = track.mediaStreamTrack.clone();
        const mediaStream = new MediaStream([clonedTrack]);
        const source = ctx.createMediaStreamSource(mediaStream);

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = s.compressorThreshold;
        compressor.knee.value = s.compressorKnee;
        compressor.ratio.value = s.compressorRatio;
        compressor.attack.value = s.compressorAttack;
        compressor.release.value = s.compressorRelease;

        const makeupGainNode = ctx.createGain();
        makeupGainNode.gain.value = s.makeupGain;

        const userGain = ctx.createGain();
        userGain.gain.value = s.userMuted[identity]
          ? 0
          : (s.userVolumes[identity] ?? 1.0);

        if (s.normalizationEnabled) {
          source.connect(compressor);
          compressor.connect(makeupGainNode);
          makeupGainNode.connect(userGain);
        } else {
          source.connect(userGain);
        }

        const mediaStreamDest = ctx.createMediaStreamDestination();
        userGain.connect(masterGainRef.current);

        userGain.connect(mediaStreamDest);
        const sinkEl = document.createElement("audio");
        sinkEl.srcObject = mediaStreamDest.stream;
        sinkEl.autoplay = true;

        if (s.preferredOutputDeviceId) {
          sinkEl.muted = false;
          sinkEl.volume = 1;
          userGain.disconnect(masterGainRef.current);
          if ("setSinkId" in sinkEl) {
            (sinkEl as AudioElementWithSinkId)
              .setSinkId(s.preferredOutputDeviceId)
              .catch(() => {});
          }
        } else {
          sinkEl.muted = true;
        }

        safePlay(sinkEl);

        return {
          source,
          compressor,
          makeupGainNode,
          userGain,
          sinkEl,
          mediaStreamDest,
          clonedTrack,
        };
      } catch {
        return null;
      }
    },
    [getOrCreateCtx], // getOrCreateCtx is stable
  );

  // ── Main track sync ──────────────────────────────────────────────────
  // Only re-runs when the set of remote tracks changes.
  useEffect(() => {
    const chains = chainsRef.current;
    const s = settingsRef.current;

    const remoteTracks = trackRefs.filter(
      (tr) => tr.publication?.track && !tr.participant.isLocal,
    );

    const activeKeys = new Set(
      remoteTracks.map(
        (tr) => `${tr.participant.identity}:${tr.publication.track!.sid}`,
      ),
    );

    // Remove chains for departed tracks
    for (const [key, chain] of chains.entries()) {
      if (!activeKeys.has(key)) {
        destroyChain(chain);
        chains.delete(key);
      }
    }

    // Create chains for new tracks
    for (const tr of remoteTracks) {
      const track = tr.publication.track! as RemoteTrack;
      const identity = tr.participant.identity;
      const key = `${identity}:${track.sid}`;
      if (chains.has(key)) continue;

      // Tier 1: Native audio element via track.attach()
      const audioEl = track.attach();
      document.body.appendChild(audioEl);
      safePlay(audioEl);

      if (s.preferredOutputDeviceId && "setSinkId" in audioEl) {
        (audioEl as AudioElementWithSinkId)
          .setSinkId(s.preferredOutputDeviceId)
          .catch(() => {});
      }

      // Tier 2: Try Web Audio enhancement (may return null)
      const webAudio = createWebAudioNodes(track, identity);

      // Soundboard tracks are published with name "soundboard"
      const isSoundboard = tr.publication.trackName === "soundboard";

      const chain: ParticipantChain = {
        audioEl,
        remoteTrack: track,
        identity,
        isSoundboard,
        webAudio,
      };

      // Set initial volume via the shared logic
      applyVolumeToChain(chain);
      chains.set(key, chain);
    }
  }, [trackRefs, createWebAudioNodes, applyVolumeToChain]);

  // ── Volume/mute updates ──────────────────────────────────────────────
  useEffect(() => {
    applyAllVolumes();
  }, [userVolumes, userMuted, masterOutputVolume, soundboardVolume, applyAllVolumes]);

  // ── Master gain node (Tier 2) ────────────────────────────────────────
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = masterOutputVolume;
    }
  }, [masterOutputVolume]);

  // ── Compressor params ────────────────────────────────────────────────
  useEffect(() => {
    for (const chain of chainsRef.current.values()) {
      if (!chain.webAudio) continue;
      chain.webAudio.compressor.threshold.value = compressorThreshold;
      chain.webAudio.compressor.knee.value = compressorKnee;
      chain.webAudio.compressor.ratio.value = compressorRatio;
      chain.webAudio.compressor.attack.value = compressorAttack;
      chain.webAudio.compressor.release.value = compressorRelease;
    }
  }, [
    compressorThreshold,
    compressorKnee,
    compressorRatio,
    compressorAttack,
    compressorRelease,
  ]);

  // ── Normalization toggle ─────────────────────────────────────────────
  useEffect(() => {
    for (const chain of chainsRef.current.values()) {
      if (!chain.webAudio) continue;
      const wa = chain.webAudio;
      if (normalizationEnabled) {
        wa.source.disconnect();
        wa.source.connect(wa.compressor);
        wa.compressor.connect(wa.makeupGainNode);
        wa.makeupGainNode.connect(wa.userGain);
        wa.makeupGainNode.gain.value = makeupGain;
      } else {
        wa.source.disconnect();
        wa.compressor.disconnect();
        wa.makeupGainNode.disconnect();
        wa.source.connect(wa.userGain);
      }
    }
  }, [normalizationEnabled, makeupGain]);

  // ── Output device ────────────────────────────────────────────────────
  useEffect(() => {
    for (const chain of chainsRef.current.values()) {
      if ("setSinkId" in chain.audioEl) {
        (chain.audioEl as AudioElementWithSinkId)
          .setSinkId(preferredOutputDeviceId ?? "")
          .catch(() => {});
      }
      if (chain.webAudio && "setSinkId" in chain.webAudio.sinkEl) {
        (chain.webAudio.sinkEl as AudioElementWithSinkId)
          .setSinkId(preferredOutputDeviceId ?? "")
          .catch(() => {});
      }
    }
  }, [preferredOutputDeviceId]);

  // ── Resume AudioContext on user interaction ───────────────────────────
  useEffect(() => {
    const resume = () => {
      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
      // Retry play on any audio elements blocked by autoplay policy
      for (const chain of chainsRef.current.values()) {
        if (chain.audioEl.paused) safePlay(chain.audioEl);
        if (chain.webAudio?.sinkEl.paused) safePlay(chain.webAudio.sinkEl);
      }
    };
    document.addEventListener("click", resume);
    document.addEventListener("keydown", resume);
    return () => {
      document.removeEventListener("click", resume);
      document.removeEventListener("keydown", resume);
    };
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const chain of chainsRef.current.values()) {
        destroyChain(chain);
      }
      chainsRef.current.clear();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  return null;
}
