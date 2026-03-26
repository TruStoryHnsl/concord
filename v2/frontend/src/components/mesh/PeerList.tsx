import { useMeshStore } from "@/stores/mesh";
import NodeChip from "@/components/ui/NodeChip";
import GlassPanel from "@/components/ui/GlassPanel";
import { shortenPeerId } from "@/utils/format";

function PeerList() {
  const nearbyPeers = useMeshStore((s) => s.nearbyPeers);

  return (
    <GlassPanel className="rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-lg">
            group
          </span>
          <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
            Nearby Peers
          </span>
        </div>
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-secondary/15 text-secondary text-[11px] font-label font-semibold">
          {nearbyPeers.length}
        </span>
      </div>

      {nearbyPeers.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center space-y-2">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">
            search
          </span>
          <p className="text-xs text-on-surface-variant font-body">
            Scanning for nearby nodes...
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {nearbyPeers.map((peer) => (
            <div
              key={peer.peerId}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-container/50 hover:bg-surface-container-high/50 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                <span className="material-symbols-outlined text-primary text-base">
                  device_hub
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-label font-medium text-on-surface truncate">
                  {peer.displayName ?? shortenPeerId(peer.peerId)}
                </p>
                <p className="text-[10px] text-on-surface-variant font-body truncate">
                  {shortenPeerId(peer.peerId)}
                </p>
              </div>
              <NodeChip status="active" label="Online" />
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

export default PeerList;
