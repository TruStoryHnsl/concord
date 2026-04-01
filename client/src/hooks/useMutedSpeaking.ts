import { useEffect, useRef, useState } from "react";

/**
 * Monitors the local microphone while the user is muted in LiveKit.
 * Returns true when the user is speaking into a muted mic — used to
 * show a "you're muted" visual reminder on their own tile.
 *
 * Opens a separate getUserMedia stream (LiveKit's track produces silence
 * when disabled, so we can't re-use it for level analysis).
 */
export function useMutedSpeaking(
  isMicEnabled: boolean,
  preferredDeviceId?: string,
): boolean {
  const [speaking, setSpeaking] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (isMicEnabled) {
      setSpeaking(false);
      cleanupRef.current?.();
      cleanupRef.current = null;
      return;
    }

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: preferredDeviceId
            ? { deviceId: { ideal: preferredDeviceId } }
            : true,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const THRESHOLD = 15;

        const interval = setInterval(() => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          setSpeaking(avg > THRESHOLD);
        }, 100);

        cleanupRef.current = () => {
          clearInterval(interval);
          source.disconnect();
          ctx.close();
          stream.getTracks().forEach((t) => t.stop());
          setSpeaking(false);
        };
      } catch {
        // Mic not available — no monitoring
      }
    }

    start();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [isMicEnabled, preferredDeviceId]);

  return speaking;
}
