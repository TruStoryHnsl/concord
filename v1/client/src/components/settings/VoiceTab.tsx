import { useState, useEffect, useRef, useCallback } from "react";
import { useSettingsStore } from "../../stores/settings";
import { Slider } from "../ui/Slider";

export function VoiceTab() {
  const masterInputVolume = useSettingsStore((s) => s.masterInputVolume);
  const setMasterInputVolume = useSettingsStore((s) => s.setMasterInputVolume);
  const preferredInputDeviceId = useSettingsStore(
    (s) => s.preferredInputDeviceId,
  );
  const setPreferredInputDeviceId = useSettingsStore(
    (s) => s.setPreferredInputDeviceId,
  );
  const echoCancellation = useSettingsStore((s) => s.echoCancellation);
  const setEchoCancellation = useSettingsStore((s) => s.setEchoCancellation);
  const noiseSuppression = useSettingsStore((s) => s.noiseSuppression);
  const setNoiseSuppression = useSettingsStore((s) => s.setNoiseSuppression);
  const autoGainControl = useSettingsStore((s) => s.autoGainControl);
  const setAutoGainControl = useSettingsStore((s) => s.setAutoGainControl);

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devices) => {
      setInputDevices(devices.filter((d) => d.kind === "audioinput"));
    });
  }, []);

  // Mic level meter — opens a temporary stream to visualize input level
  const startMeter = useCallback(async () => {
    // Clean up any existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    cancelAnimationFrame(rafRef.current);

    try {
      if (!navigator.mediaDevices) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: preferredInputDeviceId
            ? { exact: preferredInputDeviceId }
            : undefined,
          echoCancellation,
          noiseSuppression,
          autoGainControl,
        },
      });
      streamRef.current = stream;
      // Close previous AudioContext before creating a new one
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const peak = Math.max(...data) / 255;
        setMicLevel(peak);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMicLevel(0);
    }
  }, [
    preferredInputDeviceId,
    echoCancellation,
    noiseSuppression,
    autoGainControl,
  ]);

  // Start meter on mount, restart when device/settings change
  useEffect(() => {
    startMeter();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, [startMeter]);

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-white">Voice</h3>

      {/* Input Volume */}
      <Slider
        label="Input Volume"
        value={masterInputVolume}
        min={0}
        max={2}
        step={0.01}
        onChange={setMasterInputVolume}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />

      {/* Input Device */}
      {inputDevices.length > 0 && (
        <div>
          <label className="block text-sm text-zinc-300 mb-1.5">
            Input Device
          </label>
          <select
            value={preferredInputDeviceId ?? ""}
            onChange={(e) =>
              setPreferredInputDeviceId(e.target.value || null)
            }
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-md text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="">Default</option>
            {inputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mic level meter */}
      <div>
        <label className="block text-sm text-zinc-300 mb-1.5">
          Mic Level
        </label>
        <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${micLevel * 100}%`,
              backgroundColor:
                micLevel > 0.8
                  ? "#ef4444"
                  : micLevel > 0.5
                    ? "#eab308"
                    : "#22c55e",
            }}
          />
        </div>
      </div>

      {/* Processing toggles */}
      <div className="border-t border-zinc-700 pt-6 space-y-4">
        <h4 className="text-sm font-medium text-white">Voice Processing</h4>

        <Toggle
          label="Echo Cancellation"
          description="Prevents your speakers from feeding back into your mic"
          checked={echoCancellation}
          onChange={setEchoCancellation}
        />
        <Toggle
          label="Noise Suppression"
          description="Reduces background noise like fans or keyboard clicks"
          checked={noiseSuppression}
          onChange={setNoiseSuppression}
        />
        <Toggle
          label="Auto Gain Control"
          description="Automatically adjusts mic sensitivity to maintain consistent level"
          checked={autoGainControl}
          onChange={setAutoGainControl}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-zinc-300">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-4 ${
          checked ? "bg-indigo-500" : "bg-zinc-600"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
