import type { AudioCaptureOptions } from "livekit-client";
import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";

export const INPUT_NOISE_GATE_DB_MIN = -72;
export const INPUT_NOISE_GATE_DB_MAX = -18;
export const INPUT_NOISE_GATE_DB_DEFAULT = -42;
export const INPUT_NOISE_GATE_HYSTERESIS_DB = 6;
export const INPUT_NOISE_GATE_HOLD_MS = 220;
export const INPUT_NOISE_GATE_ATTACK_SECONDS = 0.015;
export const INPUT_NOISE_GATE_RELEASE_SECONDS = 0.14;
export const INPUT_SIGNAL_METER_FLOOR_DB = -72;
export const INPUT_SIGNAL_METER_CEIL_DB = -6;
const SILENCE_FLOOR_DB = -100;
type VoiceIsolationConstraints = MediaTrackConstraints & {
  voiceIsolation?: ConstrainBoolean;
};
type VoiceIsolationSupportedConstraints = MediaTrackSupportedConstraints & {
  voiceIsolation?: boolean;
};

export interface VoiceInputSettings {
  masterInputVolume: number;
  preferredInputDeviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputNoiseGateEnabled: boolean;
  inputNoiseGateThresholdDb: number;
}

export function computeSignalLevelDb(samples: ArrayLike<number>): number {
  const count = samples.length;
  if (!count) return SILENCE_FLOOR_DB;
  let sumSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const value = Number(samples[i]) || 0;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / count);
  if (!Number.isFinite(rms) || rms <= 0) return SILENCE_FLOOR_DB;
  return Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(rms));
}

export function normalizeSignalLevelDbToMeter(
  levelDb: number,
  floorDb = INPUT_SIGNAL_METER_FLOOR_DB,
  ceilDb = INPUT_SIGNAL_METER_CEIL_DB,
): number {
  if (!Number.isFinite(levelDb)) return 0;
  if (levelDb <= floorDb) return 0;
  if (levelDb >= ceilDb) return 1;
  return (levelDb - floorDb) / (ceilDb - floorDb);
}

export function resolveNoiseGateOpenState({
  levelDb,
  thresholdDb,
  wasOpen,
  nowMs,
  heldUntilMs,
  hysteresisDb = INPUT_NOISE_GATE_HYSTERESIS_DB,
}: {
  levelDb: number;
  thresholdDb: number;
  wasOpen: boolean;
  nowMs: number;
  heldUntilMs: number;
  hysteresisDb?: number;
}): boolean {
  if (levelDb >= thresholdDb) return true;
  if (wasOpen && levelDb >= thresholdDb - hysteresisDb) return true;
  return nowMs < heldUntilMs;
}

export function buildMicTrackConstraints(
  settings: VoiceInputSettings,
): MediaTrackConstraints {
  const constraints: VoiceIsolationConstraints = {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    ...(settings.preferredInputDeviceId
      ? { deviceId: { ideal: settings.preferredInputDeviceId } }
      : {}),
  };

  const supported =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getSupportedConstraints
      ? (navigator.mediaDevices.getSupportedConstraints() as VoiceIsolationSupportedConstraints)
      : null;

  if (supported?.voiceIsolation && settings.noiseSuppression) {
    constraints.voiceIsolation = true;
  }

  return constraints;
}

class ConcordNoiseGateProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  public readonly name = "concord-noise-gate";
  public processedTrack?: MediaStreamTrack;

  private settings: VoiceInputSettings;
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private highpassFilter?: BiquadFilterNode;
  private analyserNode?: AnalyserNode;
  private outputGainNode?: GainNode;
  private gateGainNode?: GainNode;
  private destinationNode?: MediaStreamAudioDestinationNode;
  private monitorTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private gateOpen = false;
  private heldUntilMs = 0;
  private ownsProcessedTrack = false;

  constructor(settings: VoiceInputSettings) {
    this.settings = { ...settings };
  }

  updateSettings(settings: VoiceInputSettings): void {
    this.settings = { ...settings };
    if (this.outputGainNode) {
      this.outputGainNode.gain.value = settings.masterInputVolume;
    }
    if (this.gateGainNode && !settings.inputNoiseGateEnabled) {
      this.gateOpen = true;
      this.heldUntilMs = 0;
      this.rampGate(true);
    }
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    await this.restart(opts);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    this.audioContext = opts.audioContext;
    this.gateOpen = !this.settings.inputNoiseGateEnabled;
    this.heldUntilMs = 0;

    try {
      const sourceStream = new MediaStream([opts.track]);
      this.sourceNode = opts.audioContext.createMediaStreamSource(sourceStream);

      this.highpassFilter = opts.audioContext.createBiquadFilter();
      this.highpassFilter.type = "highpass";
      this.highpassFilter.frequency.value = 115;
      this.highpassFilter.Q.value = 0.7;

      this.analyserNode = opts.audioContext.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.18;

      this.outputGainNode = opts.audioContext.createGain();
      this.outputGainNode.gain.value = this.settings.masterInputVolume;

      this.gateGainNode = opts.audioContext.createGain();
      this.gateGainNode.gain.value = this.gateOpen ? 1 : 0;

      this.destinationNode = opts.audioContext.createMediaStreamDestination();

      this.sourceNode.connect(this.highpassFilter);
      this.highpassFilter.connect(this.analyserNode);
      this.highpassFilter.connect(this.outputGainNode);
      this.outputGainNode.connect(this.gateGainNode);
      this.gateGainNode.connect(this.destinationNode);

      const outputTrack = this.destinationNode.stream.getAudioTracks()[0];
      if (outputTrack) {
        this.processedTrack = outputTrack;
        this.ownsProcessedTrack = true;
      } else {
        this.processedTrack = opts.track;
        this.ownsProcessedTrack = false;
      }

      this.startMonitoring();
    } catch {
      this.processedTrack = opts.track;
      this.ownsProcessedTrack = false;
    }
  }

  async destroy(): Promise<void> {
    if (this.monitorTimer !== null) {
      globalThis.clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    try {
      this.sourceNode?.disconnect();
    } catch {}
    try {
      this.highpassFilter?.disconnect();
    } catch {}
    try {
      this.analyserNode?.disconnect();
    } catch {}
    try {
      this.outputGainNode?.disconnect();
    } catch {}
    try {
      this.gateGainNode?.disconnect();
    } catch {}
    try {
      this.destinationNode?.disconnect();
    } catch {}
    if (this.ownsProcessedTrack) {
      this.processedTrack?.stop();
    }
    this.sourceNode = undefined;
    this.highpassFilter = undefined;
    this.analyserNode = undefined;
    this.outputGainNode = undefined;
    this.gateGainNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
    this.ownsProcessedTrack = false;
  }

  private startMonitoring(): void {
    if (!this.analyserNode || !this.gateGainNode) return;
    const samples = new Float32Array(this.analyserNode.fftSize);
    this.monitorTimer = globalThis.setInterval(() => {
      if (!this.analyserNode) return;
      this.analyserNode.getFloatTimeDomainData(samples);
      if (!this.settings.inputNoiseGateEnabled) {
        if (!this.gateOpen) {
          this.gateOpen = true;
          this.rampGate(true);
        }
        return;
      }

      const levelDb = computeSignalLevelDb(samples);
      const nowMs =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (levelDb >= this.settings.inputNoiseGateThresholdDb) {
        this.heldUntilMs = nowMs + INPUT_NOISE_GATE_HOLD_MS;
      }

      const shouldOpen = resolveNoiseGateOpenState({
        levelDb,
        thresholdDb: this.settings.inputNoiseGateThresholdDb,
        wasOpen: this.gateOpen,
        nowMs,
        heldUntilMs: this.heldUntilMs,
      });

      if (shouldOpen !== this.gateOpen) {
        this.gateOpen = shouldOpen;
        this.rampGate(shouldOpen);
      }
    }, 40);
  }

  private rampGate(open: boolean): void {
    if (!this.gateGainNode || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const gain = this.gateGainNode.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(
      open ? 1 : 0,
      now + (open ? INPUT_NOISE_GATE_ATTACK_SECONDS : INPUT_NOISE_GATE_RELEASE_SECONDS),
    );
  }
}

let sharedProcessor: ConcordNoiseGateProcessor | null = null;

export function getVoiceInputProcessor(
  settings: VoiceInputSettings,
): ConcordNoiseGateProcessor {
  if (!sharedProcessor) {
    sharedProcessor = new ConcordNoiseGateProcessor(settings);
  } else {
    sharedProcessor.updateSettings(settings);
  }
  return sharedProcessor;
}

export function resetVoiceInputProcessorForTests(): void {
  if (sharedProcessor) {
    void sharedProcessor.destroy();
  }
  sharedProcessor = null;
}

export function buildLiveKitAudioCaptureOptions(
  settings: VoiceInputSettings,
): AudioCaptureOptions {
  // IMPORTANT: no ``processor`` key here. Passing one via capture options
  // triggers LiveKit's ``createLocalTracks`` → internal ``setProcessor``
  // call, which requires ``LocalAudioTrack.audioContext`` to be set.
  // But LiveKit's Room only calls ``track.setAudioContext(...)`` AFTER
  // ``createLocalTracks`` returns (see Room.mergedOptionsWithProcessors in
  // livekit-client.esm.mjs), so the context attachment lands too late and
  // the ``setProcessor`` throws
  // ``Audio context needs to be set on LocalAudioTrack``. That cascades
  // into ``onError → voiceDisconnect → "Client initiated disconnect"``
  // — the three-toast pileup the user has reported.
  //
  // The processor is instead attached post-publish by the useEffect in
  // ``VoiceChannel.tsx``, which guards on ``micTrack.audioContext`` and
  // is invoked only once the track has been fully set up inside the
  // room. That guard is the single source of truth for "is it safe to
  // enable processors on this track" — don't add the processor back
  // here without removing the guard there first.
  return buildMicTrackConstraints(settings);
}
