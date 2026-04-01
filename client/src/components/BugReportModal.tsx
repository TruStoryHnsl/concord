import { useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useVoiceStore } from "../stores/voice";
import { useToastStore } from "../stores/toast";
import { submitBugReport } from "../api/concord";

function gatherSystemInfo(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenResolution: `${screen.width}x${screen.height}`,
    windowSize: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory ?? null,
    isSecureContext: window.isSecureContext,
    isElectron: !!nav.userAgentData?.platform || navigator.userAgent.includes("Electron"),
    url: window.location.href,
    timestamp: new Date().toISOString(),
    colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
    online: navigator.onLine,
    cookiesEnabled: navigator.cookieEnabled,
    audioOutputSupported: "setSinkId" in HTMLAudioElement.prototype,
    mediaDevicesAvailable: !!navigator.mediaDevices,
    webRTCSupported: !!window.RTCPeerConnection,
  };
}

export function BugReportModal({ onClose }: { onClose: () => void }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.userId);
  const voiceConnected = useVoiceStore((s) => s.connected);
  const voiceChannelName = useVoiceStore((s) => s.channelName);
  const addToast = useToastStore((s) => s.addToast);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || !accessToken) return;

    setSubmitting(true);
    try {
      const systemInfo = {
        ...gatherSystemInfo(),
        userId,
        voiceConnected,
        voiceChannel: voiceChannelName,
      };
      await submitBugReport(title.trim(), description.trim(), systemInfo, accessToken);
      addToast("Bug report submitted — thank you!", "success");
      onClose();
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to submit report",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-container rounded-xl border border-outline-variant/15 shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/15">
          <h2 className="text-lg font-semibold text-on-surface">Report a Bug</h2>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the issue"
              maxLength={200}
              autoFocus
              className="w-full px-3 py-2 bg-surface border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? What did you expect to happen?"
              maxLength={5000}
              rows={5}
              className="w-full px-3 py-2 bg-surface border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>

          <p className="text-xs text-on-surface-variant">
            System info (browser, OS, screen size, etc.) will be attached
            automatically.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !description.trim() || submitting}
              className="px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
