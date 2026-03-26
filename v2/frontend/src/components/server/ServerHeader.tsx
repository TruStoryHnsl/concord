import { useState, useCallback } from "react";
import type { ChannelPayload } from "@/api/tauri";
import { useWebhostStore } from "@/stores/webhost";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";

interface ServerHeaderProps {
  channel: ChannelPayload | null;
  memberCount: number;
  onToggleSidebar: () => void;
  onShowInvite: () => void;
  onBack: () => void;
}

function ServerHeader({
  channel,
  memberCount,
  onToggleSidebar,
  onShowInvite,
  onBack,
}: ServerHeaderProps) {
  const webhostRunning = useWebhostStore((s) => s.isRunning);
  const webhostInfo = useWebhostStore((s) => s.info);
  const webhostStarting = useWebhostStore((s) => s.starting);
  const startWebhostServer = useWebhostStore((s) => s.startServer);
  const stopWebhostServer = useWebhostStore((s) => s.stopServer);

  const [showSharePopover, setShowSharePopover] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);

  const handleShareClick = useCallback(() => {
    if (webhostRunning) {
      setShowSharePopover((prev) => !prev);
    } else {
      void startWebhostServer();
    }
  }, [webhostRunning, startWebhostServer]);

  const handleCopyUrl = useCallback(async () => {
    if (!webhostInfo) return;
    try {
      await navigator.clipboard.writeText(webhostInfo.url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      console.warn("Failed to copy URL to clipboard");
    }
  }, [webhostInfo]);

  const handleCopyPin = useCallback(async () => {
    if (!webhostInfo) return;
    try {
      await navigator.clipboard.writeText(webhostInfo.pin);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    } catch {
      console.warn("Failed to copy PIN to clipboard");
    }
  }, [webhostInfo]);

  const channelIcon =
    channel?.channelType === "voice"
      ? "volume_up"
      : channel?.channelType === "video"
        ? "videocam"
        : "tag";

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/20 shrink-0 bg-surface-container-low/50 relative">
      {/* Back button - mobile */}
      <button
        onClick={onBack}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors md:hidden"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
      </button>

      {/* Channel sidebar toggle - mobile */}
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors md:hidden"
      >
        <span className="material-symbols-outlined text-lg">menu</span>
      </button>

      {/* Channel info */}
      {channel ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="material-symbols-outlined text-on-surface-variant text-base">
            {channelIcon}
          </span>
          <span className="font-headline font-semibold text-sm text-on-surface truncate">
            {channel.name}
          </span>
        </div>
      ) : (
        <div className="flex-1">
          <span className="text-sm text-on-surface-variant font-body">
            Select a channel
          </span>
        </div>
      )}

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Member count */}
        <button className="flex items-center gap-1 px-2 py-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors">
          <span className="material-symbols-outlined text-base">group</span>
          <span className="text-xs font-label">{memberCount}</span>
        </button>

        {/* Share / Broadcast */}
        <button
          onClick={handleShareClick}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors ${
            webhostRunning
              ? "text-secondary hover:bg-secondary/10"
              : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
          }`}
          title={webhostRunning ? "Sharing active" : "Share via Browser"}
          disabled={webhostStarting}
        >
          {webhostStarting ? (
            <span className="material-symbols-outlined text-base animate-spin">
              progress_activity
            </span>
          ) : (
            <>
              {webhostRunning && (
                <span className="w-2 h-2 rounded-full bg-secondary" />
              )}
              <span className="material-symbols-outlined text-base">
                cast
              </span>
              {webhostRunning && webhostInfo && (
                <span className="bg-secondary-container text-on-secondary-container rounded-full text-[10px] font-bold px-1.5">
                  {webhostInfo.activeGuests}
                </span>
              )}
            </>
          )}
        </button>

        {/* Invite */}
        <button
          onClick={onShowInvite}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Invite"
        >
          <span className="material-symbols-outlined text-lg">
            person_add
          </span>
        </button>
      </div>

      {/* Share popover */}
      {showSharePopover && webhostRunning && webhostInfo && (
        <>
          {/* Backdrop to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowSharePopover(false)}
          />
          <div className="absolute right-2 top-full mt-1 z-50 w-80">
            <GlassPanel className="p-4 space-y-3 shadow-xl shadow-background/50">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-xs font-label font-semibold text-secondary">
                    Sharing Active
                  </span>
                </div>
                <span className="bg-secondary-container text-on-secondary-container rounded-full text-xs font-bold px-2 py-0.5">
                  {webhostInfo.activeGuests} guest{webhostInfo.activeGuests !== 1 ? "s" : ""}
                </span>
              </div>

              {/* URL */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-lowest/50 cursor-pointer hover:bg-surface-container-low transition-colors"
                onClick={handleCopyUrl}
              >
                <code className="font-mono text-primary text-sm flex-1 select-all break-all">
                  {webhostInfo.url}
                </code>
                <span className="material-symbols-outlined text-on-surface-variant text-base">
                  {copiedUrl ? "check" : "content_copy"}
                </span>
              </div>

              {/* PIN */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-lowest/50 cursor-pointer hover:bg-surface-container-low transition-colors"
                onClick={handleCopyPin}
              >
                <span className="font-headline text-xl tracking-[0.3em] text-secondary flex-1 select-all">
                  {webhostInfo.pin}
                </span>
                <span className="material-symbols-outlined text-on-surface-variant text-base">
                  {copiedPin ? "check" : "content_copy"}
                </span>
              </div>

              {/* Stop */}
              <Button
                variant="danger"
                className="w-full text-xs py-1.5"
                onClick={() => {
                  void stopWebhostServer();
                  setShowSharePopover(false);
                }}
              >
                <span className="material-symbols-outlined text-sm">
                  stop_circle
                </span>
                Stop Sharing
              </Button>
            </GlassPanel>
          </div>
        </>
      )}
    </div>
  );
}

export default ServerHeader;
