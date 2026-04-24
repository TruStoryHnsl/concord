import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLiveKitAudioCaptureOptions,
  buildMicTrackConstraints,
  computeSignalLevelDb,
  getVoiceInputProcessor,
  INPUT_NOISE_GATE_DB_DEFAULT,
  normalizeSignalLevelDbToMeter,
  resetVoiceInputProcessorForTests,
  resolveNoiseGateOpenState,
} from "../noiseGate";

const baseSettings = {
  masterInputVolume: 1,
  preferredInputDeviceId: "mic-123",
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  inputNoiseGateEnabled: true,
  inputNoiseGateThresholdDb: INPUT_NOISE_GATE_DB_DEFAULT,
} as const;

describe("noiseGate", () => {
  afterEach(() => {
    resetVoiceInputProcessorForTests();
    vi.restoreAllMocks();
  });

  it("computes dB from PCM samples", () => {
    const quiet = new Float32Array(1024).fill(0);
    const medium = new Float32Array(1024).fill(0.1);

    expect(computeSignalLevelDb(quiet)).toBe(-100);
    expect(Math.round(computeSignalLevelDb(medium))).toBe(-20);
  });

  it("normalizes signal levels into a meter range", () => {
    expect(normalizeSignalLevelDbToMeter(-90)).toBe(0);
    expect(normalizeSignalLevelDbToMeter(-6)).toBe(1);
    expect(normalizeSignalLevelDbToMeter(-39)).toBeGreaterThan(0.4);
  });

  it("keeps the gate open briefly with hysteresis", () => {
    expect(
      resolveNoiseGateOpenState({
        levelDb: -45,
        thresholdDb: -42,
        wasOpen: true,
        nowMs: 1000,
        heldUntilMs: 1200,
      }),
    ).toBe(true);

    expect(
      resolveNoiseGateOpenState({
        levelDb: -60,
        thresholdDb: -42,
        wasOpen: false,
        nowMs: 1000,
        heldUntilMs: 900,
      }),
    ).toBe(false);
  });

  it("builds mic constraints with voice isolation when supported", () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getSupportedConstraints: () => ({ voiceIsolation: true }),
      },
    });

    const constraints = buildMicTrackConstraints(baseSettings);

    expect(constraints.deviceId).toEqual({ ideal: "mic-123" });
    expect((constraints as MediaTrackConstraints & { voiceIsolation?: boolean }).voiceIsolation).toBe(true);
  });

  it("does NOT attach a processor to capture options", () => {
    // Regression guard for the v0.4-era three-toast pileup: if the
    // processor is passed via AudioCaptureOptions, LiveKit's
    // createLocalTracks → setProcessor path runs before the room's
    // setAudioContext, LocalAudioTrack.audioContext is still
    // undefined, and setProcessor throws "Audio context needs to be
    // set on LocalAudioTrack in order to enable processors". We
    // instead attach the processor post-publish from VoiceChannel's
    // useEffect (with a guard on micTrack.audioContext). Keep this
    // test red if someone reintroduces the processor field here.
    const opts = buildLiveKitAudioCaptureOptions(baseSettings);
    expect((opts as { processor?: unknown }).processor).toBeUndefined();
  });

  it("returns the same processor singleton regardless of call count", () => {
    // getVoiceInputProcessor backs the post-publish VoiceChannel path;
    // its stability is what lets the useEffect bail out with
    // "processor already current" on a no-op settings tick.
    const a = getVoiceInputProcessor(baseSettings);
    const b = getVoiceInputProcessor({
      ...baseSettings,
      inputNoiseGateThresholdDb: -36,
    });
    expect(a).toBe(b);
    expect(a.name).toBe("concord-noise-gate");
  });
});
