import { useState, useCallback, useEffect } from "react";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import type { WebhookPayload, ChannelPayload } from "@/api/tauri";
import { createWebhook, getWebhooks, deleteWebhook } from "@/api/tauri";

interface WebhookPanelProps {
  serverId: string;
  channels: ChannelPayload[];
  onClose: () => void;
}

function WebhookPanel({ serverId, channels, onClose }: WebhookPanelProps) {
  const [webhooks, setWebhooks] = useState<WebhookPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newChannelId, setNewChannelId] = useState(
    channels.find((c) => c.channelType === "text")?.id ?? "",
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textChannels = channels.filter((c) => c.channelType === "text");

  const loadWebhooks = useCallback(async () => {
    try {
      const hooks = await getWebhooks(serverId);
      setWebhooks(hooks);
    } catch (err) {
      console.warn("Failed to load webhooks:", err);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Webhook name is required");
      return;
    }
    if (!newChannelId) {
      setError("Select a target channel");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const hook = await createWebhook(serverId, newChannelId, trimmed);
      setWebhooks((prev) => [...prev, hook]);
      setNewName("");
      setShowCreate(false);
    } catch (err) {
      console.error("Failed to create webhook:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create webhook",
      );
    } finally {
      setCreating(false);
    }
  }, [serverId, newChannelId, newName]);

  const handleDelete = useCallback(
    async (webhookId: string) => {
      try {
        await deleteWebhook(webhookId);
        setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
      } catch (err) {
        console.error("Failed to delete webhook:", err);
      }
    },
    [],
  );

  const handleCopyUrl = useCallback(async (webhook: WebhookPayload) => {
    try {
      await navigator.clipboard.writeText(webhook.webhookUrl);
      setCopiedId(webhook.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      console.warn("Failed to copy webhook URL");
    }
  }, []);

  const channelName = (channelId: string) =>
    channels.find((c) => c.id === channelId)?.name ?? channelId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm">
      <GlassPanel className="w-full max-w-lg p-6 space-y-5 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              webhook
            </span>
            <h2 className="font-headline font-bold text-lg text-on-surface">
              Webhooks
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
          Webhooks let external apps (CI, monitoring, RSS) push messages into
          channels via HTTP POST.
        </p>

        {/* Webhook List */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="material-symbols-outlined text-on-surface-variant text-2xl animate-spin">
              progress_activity
            </span>
          </div>
        ) : webhooks.length === 0 && !showCreate ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <span className="material-symbols-outlined text-on-surface-variant/40 text-4xl">
              smart_toy
            </span>
            <p className="text-sm text-on-surface-variant font-body">
              No webhooks yet
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {webhooks.map((hook) => (
              <div
                key={hook.id}
                className="p-3 rounded-xl bg-surface-container space-y-2"
              >
                {/* Name + channel */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-primary text-base">
                      smart_toy
                    </span>
                    <span className="font-headline font-semibold text-sm text-on-surface truncate">
                      {hook.name}
                    </span>
                    <span className="text-[10px] font-label text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container-high shrink-0">
                      #{channelName(hook.channelId)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-label text-on-surface-variant">
                      {hook.messageCount} msg{hook.messageCount !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => void handleDelete(hook.id)}
                      className="flex items-center justify-center w-6 h-6 rounded-md text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                      title="Delete webhook"
                    >
                      <span className="material-symbols-outlined text-sm">
                        delete
                      </span>
                    </button>
                  </div>
                </div>

                {/* Copyable URL */}
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-high cursor-pointer hover:bg-surface-bright transition-colors"
                  onClick={() => void handleCopyUrl(hook)}
                >
                  <code className="font-mono text-primary/80 text-[11px] flex-1 select-all break-all">
                    {hook.webhookUrl}
                  </code>
                  <span className="material-symbols-outlined text-on-surface-variant text-sm shrink-0">
                    {copiedId === hook.id ? "check" : "content_copy"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Form */}
        {showCreate && (
          <div className="space-y-3 p-4 rounded-xl bg-surface-container-high">
            <div className="space-y-2">
              <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="GitHub CI"
                className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Target Channel
              </label>
              <select
                value={newChannelId}
                onChange={(e) => setNewChannelId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-container text-on-surface font-body text-sm border-none focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {textChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-xs text-error font-body">{error}</p>
            )}

            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex-1 text-xs py-1.5"
                onClick={() => void handleCreate()}
                disabled={creating}
              >
                {creating ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">
                      progress_activity
                    </span>
                    Creating...
                  </>
                ) : (
                  "Create"
                )}
              </Button>
              <Button
                variant="secondary"
                className="text-xs py-1.5"
                onClick={() => {
                  setShowCreate(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bottom actions */}
        <div className="flex gap-2">
          {!showCreate && (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => setShowCreate(true)}
            >
              <span className="material-symbols-outlined text-lg">add</span>
              Create Webhook
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}

export default WebhookPanel;
