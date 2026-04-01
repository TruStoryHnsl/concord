import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import NodeChip from "@/components/ui/NodeChip";
import Skeleton from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import JoinServerModal from "@/components/server/JoinServerModal";
import { useServersStore } from "@/stores/servers";
import type { ServerPayload } from "@/api/tauri";

function ServersPage() {
  const servers = useServersStore((s) => s.servers);
  const loadingServers = useServersStore((s) => s.loadingServers);
  const loadServers = useServersStore((s) => s.loadServers);
  const [showJoinModal, setShowJoinModal] = useState(false);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  return (
    <div className="mesh-background min-h-full p-4 md:p-6">
      <div className="relative z-10 max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="font-headline font-bold text-2xl text-on-surface">
              Servers
            </h1>
            <p className="text-sm text-on-surface-variant font-body">
              Your servers and communities on the mesh.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowJoinModal(true)}>
              <span className="material-symbols-outlined text-lg">login</span>
              Join
            </Button>
            <Link to="/host">
              <Button variant="primary">
                <span className="material-symbols-outlined text-lg">add</span>
                Host
              </Button>
            </Link>
          </div>
        </div>

        {/* Server list */}
        {loadingServers ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <GlassPanel key={i} className="rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10" circle />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              </GlassPanel>
            ))}
          </div>
        ) : servers.length === 0 ? (
          <GlassPanel className="rounded-xl p-8 flex flex-col items-center text-center space-y-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
              <span className="material-symbols-outlined text-4xl text-primary/40">
                dns
              </span>
            </div>
            <div className="space-y-1">
              <p className="font-headline font-semibold text-on-surface">
                No servers yet
              </p>
              <p className="text-sm text-on-surface-variant font-body max-w-xs">
                Host your own server or join one with an invite code.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/host">
                <Button variant="primary">
                  <span className="material-symbols-outlined text-lg">add</span>
                  Host Server
                </Button>
              </Link>
            </div>
          </GlassPanel>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <ServerListCard key={server.id} server={server} />
            ))}
          </div>
        )}
      </div>

      {/* Join Server Modal */}
      {showJoinModal && (
        <JoinServerModal onClose={() => setShowJoinModal(false)} />
      )}
    </div>
  );
}

/* ── Server List Card ────────────────────────────────────── */

function ServerListCard({ server }: { server: ServerPayload }) {
  const channelTypes = server.channels.map((c) => c.channelType);
  const hasText = channelTypes.includes("text");
  const hasVoice = channelTypes.includes("voice");
  const hasVideo = channelTypes.includes("video");

  return (
    <Link to={`/server/${server.id}`} className="block">
      <GlassPanel className="rounded-xl p-4 hover:bg-surface-container-high/30 transition-colors">
        <div className="flex items-center gap-3">
          {/* Server Icon */}
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
            <span className="material-symbols-outlined text-primary text-xl">
              dns
            </span>
          </div>

          {/* Server Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-headline font-bold text-sm text-on-surface truncate">
                {server.name}
              </p>
              {server.visibility === "public" && (
                <NodeChip status="active" label="Public" />
              )}
            </div>
            <p className="text-[11px] text-on-surface-variant font-body truncate mt-0.5">
              {server.channels.length} channel{server.channels.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1">
              {hasText && (
                <span className="material-symbols-outlined text-on-surface-variant text-base" title="Text channels">
                  tag
                </span>
              )}
              {hasVoice && (
                <span className="material-symbols-outlined text-on-surface-variant text-base" title="Voice channels">
                  volume_up
                </span>
              )}
              {hasVideo && (
                <span className="material-symbols-outlined text-on-surface-variant text-base" title="Video channels">
                  videocam
                </span>
              )}
            </div>
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-secondary/15 text-secondary text-[11px] font-label font-semibold">
              {server.memberCount}
            </span>
          </div>
        </div>
      </GlassPanel>
    </Link>
  );
}

export default ServersPage;
