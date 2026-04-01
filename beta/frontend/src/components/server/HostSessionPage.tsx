import { useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import { createServer } from "@/api/tauri";
import { useServersStore } from "@/stores/servers";
import { useWebhostStore } from "@/stores/webhost";

type Visibility = "public" | "private" | "federated";

interface ChannelDraft {
  name: string;
  channelType: "text" | "voice" | "video";
}

const visibilityOptions: {
  value: Visibility;
  icon: string;
  label: string;
  description: string;
}[] = [
  {
    value: "public",
    icon: "public",
    label: "Public",
    description: "Anyone can discover and join this server on the mesh",
  },
  {
    value: "private",
    icon: "lock",
    label: "Private",
    description: "Invite-only. Hidden from discovery, requires invite code",
  },
  {
    value: "federated",
    icon: "share",
    label: "Federated",
    description: "Discoverable across connected mesh networks",
  },
];

const sessionTypes: {
  icon: string;
  label: string;
  description: string;
  channels: ChannelDraft[];
}[] = [
  {
    icon: "tag",
    label: "Text Only",
    description: "Low latency, minimal bandwidth",
    channels: [{ name: "general", channelType: "text" }],
  },
  {
    icon: "graphic_eq",
    label: "Voice & Text",
    description: "Encrypted audio stream plus chat",
    channels: [
      { name: "general", channelType: "text" },
      { name: "voice-lobby", channelType: "voice" },
    ],
  },
  {
    icon: "videocam",
    label: "Video, Voice & Text",
    description: "High bandwidth — full media",
    channels: [
      { name: "general", channelType: "text" },
      { name: "voice-lobby", channelType: "voice" },
      { name: "video-room", channelType: "video" },
    ],
  },
];

function HostSessionPage() {
  const navigate = useNavigate();
  const addServer = useServersStore((s) => s.addServer);

  const [serverName, setServerName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [selectedSessionType, setSelectedSessionType] = useState(1); // default: Voice & Text
  const [channels, setChannels] = useState<ChannelDraft[]>(
    sessionTypes[1]?.channels ?? [],
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);

  const webhostRunning = useWebhostStore((s) => s.isRunning);
  const webhostInfo = useWebhostStore((s) => s.info);
  const webhostStarting = useWebhostStore((s) => s.starting);
  const webhostStopping = useWebhostStore((s) => s.stopping);
  const startWebhostServer = useWebhostStore((s) => s.startServer);
  const stopWebhostServer = useWebhostStore((s) => s.stopServer);

  const handleSessionTypeChange = useCallback((index: number) => {
    setSelectedSessionType(index);
    const sessionType = sessionTypes[index];
    if (sessionType) {
      setChannels(sessionType.channels);
    }
  }, []);

  const handleAddChannel = useCallback(() => {
    setChannels((prev) => [...prev, { name: "", channelType: "text" }]);
  }, []);

  const handleRemoveChannel = useCallback((index: number) => {
    setChannels((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleChannelChange = useCallback(
    (index: number, field: "name" | "channelType", value: string) => {
      setChannels((prev) =>
        prev.map((ch, i) =>
          i === index ? { ...ch, [field]: value } : ch,
        ),
      );
    },
    [],
  );

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

  const handleCreate = useCallback(async () => {
    const trimmedName = serverName.trim();
    if (!trimmedName) {
      setError("Server name is required");
      return;
    }
    if (channels.length === 0) {
      setError("At least one channel is required");
      return;
    }
    const invalidChannel = channels.find((c) => !c.name.trim());
    if (invalidChannel) {
      setError("All channels must have a name");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const server = await createServer(
        trimmedName,
        visibility,
        channels.map((c) => ({
          name: c.name.trim().toLowerCase().replace(/\s+/g, "-"),
          channelType: c.channelType,
        })),
      );
      addServer(server);
      navigate(`/server/${server.id}`);
    } catch (err) {
      console.error("Failed to create server:", err);
      setError(err instanceof Error ? err.message : "Failed to create server");
      setCreating(false);
    }
  }, [serverName, visibility, channels, addServer, navigate]);

  return (
    <div className="mesh-background min-h-full p-4 pb-24">
      <div className="relative z-10 max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-xl">
              arrow_back
            </span>
          </Link>
          <div>
            <h1 className="font-headline font-bold text-2xl text-on-surface">
              Host a New Session
            </h1>
            <p className="text-on-surface-variant text-xs font-body mt-0.5">
              Initialize a decentralized neural link. Choose your protocol and
              node persistence.
            </p>
          </div>
        </div>

        {/* Session Type Selection */}
        <div className="space-y-2">
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Choose Session Type
          </span>
          <div className="space-y-2">
            {sessionTypes.map((type, index) => (
              <button
                key={type.label}
                onClick={() => handleSessionTypeChange(index)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  selectedSessionType === index
                    ? "bg-primary/10 border border-primary/40"
                    : "bg-surface-container-low border border-transparent hover:bg-surface-container-high"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-xl ${
                    selectedSessionType === index
                      ? "bg-primary/20"
                      : "bg-surface-container-high"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-xl ${
                      selectedSessionType === index
                        ? "text-primary"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {type.icon}
                  </span>
                </div>
                <div className="flex-1">
                  <p
                    className={`font-headline font-semibold text-sm ${
                      selectedSessionType === index
                        ? "text-on-surface"
                        : "text-on-surface"
                    }`}
                  >
                    {type.label}
                  </p>
                  <p className="text-[11px] text-on-surface-variant font-body">
                    {type.description}
                  </p>
                </div>
                {selectedSessionType === index && (
                  <span className="material-symbols-outlined text-primary text-xl">
                    check_circle
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Server Name */}
        <GlassPanel className="p-5 space-y-4">
          <div className="space-y-2">
            <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              Server Name
            </label>
            <input
              type="text"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="My Server"
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container border-none text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            />
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              Choose Node Topology
            </span>
            <div className="grid grid-cols-3 gap-2">
              {visibilityOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVisibility(opt.value)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl text-center transition-all ${
                    visibility === opt.value
                      ? "bg-primary/10 border border-primary/40"
                      : "bg-surface-container-low border border-transparent hover:bg-surface-container-high"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-2xl ${
                      visibility === opt.value
                        ? "text-primary"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {opt.icon}
                  </span>
                  <span
                    className={`font-label text-xs font-semibold ${
                      visibility === opt.value
                        ? "text-on-surface"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span className="text-[10px] text-on-surface-variant font-body leading-tight">
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </GlassPanel>

        {/* Channels Configuration */}
        <GlassPanel className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              Configuration Preview
            </span>
            <button
              onClick={handleAddChannel}
              className="flex items-center gap-1 text-xs text-primary font-label font-medium hover:text-primary-dim transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Add Channel
            </button>
          </div>

          <div className="space-y-2">
            {channels.map((channel, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container"
              >
                <span className="material-symbols-outlined text-on-surface-variant text-base">
                  {channel.channelType === "text"
                    ? "tag"
                    : channel.channelType === "voice"
                      ? "volume_up"
                      : "videocam"}
                </span>
                <input
                  type="text"
                  value={channel.name}
                  onChange={(e) =>
                    handleChannelChange(index, "name", e.target.value)
                  }
                  placeholder="channel-name"
                  className="flex-1 bg-transparent text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm focus:outline-none"
                />
                <select
                  value={channel.channelType}
                  onChange={(e) =>
                    handleChannelChange(index, "channelType", e.target.value)
                  }
                  className="bg-surface-container-high text-on-surface-variant text-xs font-label px-2 py-1 rounded-lg border-none focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                  <option value="video">Video</option>
                </select>
                {channels.length > 1 && (
                  <button
                    onClick={() => handleRemoveChannel(index)}
                    className="text-on-surface-variant hover:text-error transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">
                      close
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </GlassPanel>

        {/* Browser Access */}
        <div className="space-y-2">
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Browser Guest Access
          </span>
          <GlassPanel className="p-5 space-y-4 relative overflow-hidden">
            {/* Subtle primary glow */}
            {webhostRunning && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
            )}
            <div className="relative z-10">
              {webhostRunning && webhostInfo ? (
                <div className="space-y-4">
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

                  {/* Shareable URL */}
                  <div className="space-y-1.5">
                    <span className="font-label text-[10px] uppercase tracking-widest font-bold text-secondary">
                      Shareable URL
                    </span>
                    <div
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-lowest/50 cursor-pointer hover:bg-surface-container-low transition-colors"
                      onClick={handleCopyUrl}
                    >
                      <code className="font-mono text-primary text-sm flex-1 select-all break-all tracking-wider">
                        {webhostInfo.url}
                      </code>
                      <button className="shrink-0 text-on-surface-variant hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-lg">
                          {copiedUrl ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                    {copiedUrl && (
                      <p className="text-xs text-secondary font-label">
                        URL copied to clipboard
                      </p>
                    )}
                  </div>

                  {/* PIN */}
                  <div className="space-y-1.5">
                    <span className="font-label text-[10px] uppercase tracking-widest font-bold text-secondary">
                      Session PIN
                    </span>
                    <div
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-lowest/50 cursor-pointer hover:bg-surface-container-low transition-colors"
                      onClick={handleCopyPin}
                    >
                      <span className="font-headline text-3xl tracking-[0.3em] text-secondary flex-1 select-all">
                        {webhostInfo.pin}
                      </span>
                      <button className="shrink-0 text-on-surface-variant hover:text-secondary transition-colors">
                        <span className="material-symbols-outlined text-lg">
                          {copiedPin ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                    {copiedPin && (
                      <p className="text-xs text-secondary font-label">
                        PIN copied to clipboard
                      </p>
                    )}
                  </div>

                  {/* QR Placeholder */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low/50 border border-outline-variant/10">
                    <span className="material-symbols-outlined text-on-surface-variant text-xl">
                      qr_code_2
                    </span>
                    <div className="flex-1">
                      <p className="text-xs text-on-surface-variant font-body">
                        QR code generation coming soon
                      </p>
                      <p className="text-[10px] text-on-surface-variant/60 font-body">
                        Share the URL above for now
                      </p>
                    </div>
                  </div>

                  {/* Stop sharing */}
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={() => void stopWebhostServer()}
                    disabled={webhostStopping}
                  >
                    {webhostStopping ? (
                      <>
                        <span className="material-symbols-outlined text-lg animate-spin">
                          progress_activity
                        </span>
                        Stopping...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-lg">
                          stop_circle
                        </span>
                        Stop Sharing
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-high">
                      <span className="material-symbols-outlined text-on-surface-variant text-xl">
                        language
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="font-headline font-semibold text-sm text-on-surface">
                        Browser Access
                      </p>
                      <p className="text-[11px] text-on-surface-variant font-body">
                        Let guests join from any browser — no app required
                      </p>
                    </div>
                  </div>
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
                        Starting server...
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
                </div>
              )}
            </div>
          </GlassPanel>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20">
            <span className="material-symbols-outlined text-error text-lg">
              error
            </span>
            <p className="text-sm text-on-error-container font-body">{error}</p>
          </div>
        )}

        {/* Create Button */}
        <Button
          variant="primary"
          className="w-full py-3 text-base"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <>
              <span className="material-symbols-outlined text-lg animate-spin">
                progress_activity
              </span>
              Creating...
            </>
          ) : (
            <>
              Go Live
              <span className="material-symbols-outlined text-lg">rocket_launch</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default HostSessionPage;
