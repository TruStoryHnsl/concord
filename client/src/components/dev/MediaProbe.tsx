/**
 * TEMPORARY diagnostic — getUserMedia probe for the iOS WKWebView.
 *
 * Confirms empirically whether the webview can capture mic + camera (the gate
 * for the webview-based p2p voice/video plane). Renders a fixed button; tapping
 * it calls navigator.mediaDevices.getUserMedia and shows the raw result on
 * screen (track kinds + labels on success; error name/message on failure).
 *
 * REMOVE once the iOS media-capture path is confirmed/wired.
 */
import { useState } from "react";

export function MediaProbe() {
  const [result, setResult] = useState<string>("");

  const probe = async (constraints: MediaStreamConstraints, label: string) => {
    setResult(`${label}: requesting…`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const tracks = stream.getTracks();
      setResult(
        `${label}: OK — ${tracks
          .map((t) => `${t.kind}:${t.label || "(no label)"}`)
          .join(", ")}`,
      );
      // Release immediately so we don't hold the devices.
      tracks.forEach((t) => t.stop());
    } catch (e) {
      const err = e as DOMException;
      setResult(`${label}: FAIL — ${err.name}: ${err.message}`);
    }
  };

  const hasMD = typeof navigator !== "undefined" && !!navigator.mediaDevices;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "env(safe-area-inset-bottom, 8px)",
        left: 8,
        right: 8,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        padding: "8px 10px",
        borderRadius: 10,
        fontSize: 12,
        fontFamily: "monospace",
        lineHeight: 1.35,
      }}
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <button
          onClick={() => probe({ audio: true }, "mic")}
          style={{ background: "#2a6", color: "#fff", padding: "6px 8px", borderRadius: 6 }}
        >
          test mic
        </button>
        <button
          onClick={() => probe({ video: true }, "cam")}
          style={{ background: "#26a", color: "#fff", padding: "6px 8px", borderRadius: 6 }}
        >
          test cam
        </button>
        <button
          onClick={() => probe({ audio: true, video: true }, "mic+cam")}
          style={{ background: "#a26", color: "#fff", padding: "6px 8px", borderRadius: 6 }}
        >
          test both
        </button>
      </div>
      <div>mediaDevices: {hasMD ? "present" : "MISSING"}</div>
      <div style={{ wordBreak: "break-word" }}>{result || "(tap a button)"}</div>
    </div>
  );
}
