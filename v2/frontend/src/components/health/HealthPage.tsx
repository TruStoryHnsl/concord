import GlassPanel from "@/components/ui/GlassPanel";
import NodeChip from "@/components/ui/NodeChip";

function HealthPage() {
  return (
    <div className="mesh-background min-h-full p-6">
      <div className="relative z-10 max-w-4xl mx-auto space-y-6">
        <h1 className="font-headline font-bold text-3xl text-on-surface">
          System Health
        </h1>
        <p className="text-on-surface-variant text-sm font-body">
          Monitor your node performance and network diagnostics.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassPanel className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
                Uptime
              </span>
              <NodeChip status="active" label="Healthy" />
            </div>
            <p className="font-headline text-2xl font-bold text-on-surface">--:--:--</p>
          </GlassPanel>

          <GlassPanel className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
                Memory
              </span>
              <span className="text-xs text-on-surface-variant font-body">-- MB</span>
            </div>
            <div className="w-full h-2 rounded-full bg-surface-container-highest">
              <div className="h-full rounded-full bg-secondary w-0 transition-all duration-500" />
            </div>
          </GlassPanel>

          <GlassPanel className="p-5 space-y-3">
            <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
              Bandwidth In
            </span>
            <p className="font-headline text-2xl font-bold text-on-surface">0 B/s</p>
          </GlassPanel>

          <GlassPanel className="p-5 space-y-3">
            <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
              Bandwidth Out
            </span>
            <p className="font-headline text-2xl font-bold text-on-surface">0 B/s</p>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

export default HealthPage;
