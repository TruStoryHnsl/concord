/**
 * NativeCallLayer — remote-video surface for the RUST media plane.
 *
 * On Linux desktop the distro WebKitGTK webview ships ENABLE_WEB_RTC=OFF, so
 * call media runs entirely in Rust (webrtc-rs + cpal/opus + libvpx — see
 * src-tauri/src/servitude/voice/). Audio plays natively; VIDEO cannot be
 * rendered by the webview's own WebRTC stack, so the Rust render pipeline
 * decodes inbound VP8, JPEG-compresses each frame, and emits it here over
 * the `native-remote-video-frame` Tauri event. This layer paints those
 * frames into an <img> per remote peer.
 *
 * Visibility is frame-driven: the overlay appears when the first live frame
 * arrives and hides after FRAME_STALE_MS without frames (call ended / video
 * stopped). No coupling to the webview-WebRTC call store — the two media
 * planes are mutually exclusive per platform, and WebviewCallLayer keeps
 * owning the webview plane.
 */

import { useEffect, useRef, useState } from "react";
import { isTauri } from "../../api/servitude";

interface NativeVideoFrame {
  peerId: string;
  width: number;
  height: number;
  jpegBase64: string;
  seq: number;
}

interface PeerFrameState {
  url: string;
  width: number;
  height: number;
  seq: number;
  lastAt: number;
}

/** Hide a peer tile after this long without a fresh frame. */
const FRAME_STALE_MS = 5000;

export function NativeCallLayer() {
  const [peers, setPeers] = useState<Record<string, PeerFrameState>>({});
  const peersRef = useRef(peers);
  peersRef.current = peers;

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<NativeVideoFrame>(
        "native-remote-video-frame",
        (event) => {
          const f = event.payload;
          if (!f?.peerId || !f.jpegBase64) return;
          setPeers((prev) => ({
            ...prev,
            [f.peerId]: {
              url: `data:image/jpeg;base64,${f.jpegBase64}`,
              width: f.width,
              height: f.height,
              seq: f.seq,
              lastAt: Date.now(),
            },
          }));
        },
      );
      if (disposed) off();
      else unlisten = off;
    })();

    // Prune stale peers so the overlay dismisses itself when the remote
    // stream stops.
    const prune = setInterval(() => {
      const now = Date.now();
      const cur = peersRef.current;
      const fresh = Object.entries(cur).filter(
        ([, p]) => now - p.lastAt < FRAME_STALE_MS,
      );
      if (fresh.length !== Object.keys(cur).length) {
        setPeers(Object.fromEntries(fresh));
      }
    }, 1000);

    return () => {
      disposed = true;
      unlisten?.();
      clearInterval(prune);
    };
  }, []);

  const peerList = Object.entries(peers);
  if (peerList.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[9000] bg-black/90 flex flex-col">
      <div
        className="flex-1 min-h-0 grid gap-2 p-3 place-content-center"
        style={{
          gridTemplateColumns:
            peerList.length > 1 ? "repeat(2, minmax(0,1fr))" : "minmax(0,1fr)",
        }}
      >
        {peerList.map(([peerId, p]) => (
          <div
            key={peerId}
            className="relative rounded-xl overflow-hidden bg-surface-container-highest aspect-video flex items-center justify-center"
          >
            <img
              src={p.url}
              alt={`Live video from peer ${peerId.slice(0, 10)}`}
              className="w-full h-full object-cover"
              data-testid="native-remote-video"
              data-peer-id={peerId}
              data-frame-seq={p.seq}
            />
            <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[10px] font-mono text-white/90 drop-shadow">
              <span className="truncate">{peerId.slice(0, 10)}…</span>
              <span className="text-green-400">
                p2p video · {p.width}×{p.height}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
