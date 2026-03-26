import { useState, useCallback } from "react";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import { createInvite } from "@/api/tauri";
import { useWebhostStore } from "@/stores/webhost";

interface InvitePanelProps {
  serverId: string;
  existingCode?: string;
  onClose: () => void;
}

function InvitePanel({ serverId, existingCode, onClose }: InvitePanelProps) {
  const [inviteCode, setInviteCode] = useState(existingCode ?? "");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedBrowserUrl, setCopiedBrowserUrl] = useState(false);
  const [copiedBrowserPin, setCopiedBrowserPin] = useState(false);

  const webhostRunning = useWebhostStore((s) => s.isRunning);
  const webhostInfo = useWebhostStore((s) => s.info);
  const webhostStarting = useWebhostStore((s) => s.starting);
  const startWebhostServer = useWebhostStore((s) => s.startServer);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const invite = await createInvite(serverId);
      setInviteCode(invite.code);
    } catch (err) {
      console.error("Failed to generate invite:", err);
    } finally {
      setGenerating(false);
    }
  }, [serverId]);

  const handleCopy = useCallback(async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      console.warn("Failed to copy to clipboard");
    }
  }, [inviteCode]);

  const handleCopyBrowserUrl = useCallback(async () => {
    if (!webhostInfo) return;
    try {
      await navigator.clipboard.writeText(webhostInfo.url);
      setCopiedBrowserUrl(true);
      setTimeout(() => setCopiedBrowserUrl(false), 2000);
    } catch {
      console.warn("Failed to copy URL to clipboard");
    }
  }, [webhostInfo]);

  const handleCopyBrowserPin = useCallback(async () => {
    if (!webhostInfo) return;
    try {
      await navigator.clipboard.writeText(webhostInfo.pin);
      setCopiedBrowserPin(true);
      setTimeout(() => setCopiedBrowserPin(false), 2000);
    } catch {
      console.warn("Failed to copy PIN to clipboard");
    }
  }, [webhostInfo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm">
      <GlassPanel className="w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              person_add
            </span>
            <h2 className="font-headline font-bold text-lg text-on-surface">
              Invite Members
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <p className="text-sm text-on-surface-variant font-body">
          Share this invite code with others to let them join your server.
        </p>

        {/* Invite Code Display */}
        {inviteCode ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Shareable Node ID
              </span>
            </div>
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-high cursor-pointer hover:bg-surface-bright transition-colors"
              onClick={handleCopy}
            >
              <span className="font-mono text-primary text-sm flex-1 select-all break-all">
                {inviteCode}
              </span>
              <button className="shrink-0 text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-lg">
                  {copied ? "check" : "content_copy"}
                </span>
              </button>
            </div>
            {copied && (
              <p className="text-xs text-secondary font-label">
                Copied to clipboard
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-6">
            <p className="text-sm text-on-surface-variant font-body">
              No invite code yet. Generate one below.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <>
                <span className="material-symbols-outlined text-lg animate-spin">
                  progress_activity
                </span>
                Generating...
              </>
            ) : inviteCode ? (
              <>
                <span className="material-symbols-outlined text-lg">
                  refresh
                </span>
                Generate New
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-lg">
                  link
                </span>
                Generate Invite
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>

        {/* Separator */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-outline-variant/30" />
          <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-label">
            or
          </span>
          <div className="flex-1 h-px bg-outline-variant/30" />
        </div>

        {/* Browser Access Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-lg">
              language
            </span>
            <span className="font-label text-[10px] uppercase tracking-widest font-bold text-secondary">
              Browser Access
            </span>
          </div>
          <p className="text-xs text-on-surface-variant font-body">
            Let anyone join from a browser — no Concord app required.
          </p>

          {webhostRunning && webhostInfo ? (
            <div className="space-y-3 p-3 rounded-xl bg-surface-container-high">
              {/* Active indicator */}
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
                onClick={handleCopyBrowserUrl}
              >
                <code className="font-mono text-primary text-sm flex-1 select-all break-all">
                  {webhostInfo.url}
                </code>
                <span className="material-symbols-outlined text-on-surface-variant text-base">
                  {copiedBrowserUrl ? "check" : "content_copy"}
                </span>
              </div>

              {/* PIN */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-lowest/50 cursor-pointer hover:bg-surface-container-low transition-colors"
                onClick={handleCopyBrowserPin}
              >
                <span className="font-headline text-xl tracking-[0.3em] text-secondary flex-1 select-all">
                  {webhostInfo.pin}
                </span>
                <span className="material-symbols-outlined text-on-surface-variant text-base">
                  {copiedBrowserPin ? "check" : "content_copy"}
                </span>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void startWebhostServer()}
              disabled={webhostStarting}
            >
              {webhostStarting ? (
                <>
                  <span className="material-symbols-outlined text-lg animate-spin">
                    progress_activity
                  </span>
                  Starting...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">
                    cast
                  </span>
                  Enable Browser Access
                </>
              )}
            </Button>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

export default InvitePanel;
