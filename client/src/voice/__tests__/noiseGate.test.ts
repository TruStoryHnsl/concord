import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLiveKitAudioCaptureOptions,
  buildMicTrackConstraints,
  computeSignalLevelDb,
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

  it("attaches a singleton livekit processor to capture options", () => {
    const first = buildLiveKitAudioCaptureOptions(baseSettings);
    const second = buildLiveKitAudioCaptureOptions({
      ...baseSettings,
      inputNoiseGateThresholdDb: -36,
    });

    expect(first.processor).toBeDefined();
    expect(second.processor).toBe(first.processor);
    expect(first.processor?.name).toBe("concord-noise-gate");
  });
});
