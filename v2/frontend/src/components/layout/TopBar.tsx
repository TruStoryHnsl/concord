import { useWebhostStore } from "@/stores/webhost";

interface TopBarProps {
  compact?: boolean;
}

function TopBar({ compact = false }: TopBarProps) {
  const webhostRunning = useWebhostStore((s) => s.isRunning);
  const webhostInfo = useWebhostStore((s) => s.info);

  return (
    <header className="flex items-center justify-between h-12 px-4 bg-surface-container-low border-b border-outline-variant/30 shrink-0">
      {/* Left: Logo & title */}
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-2xl">hub</span>
        <span className="font-headline font-bold text-lg tracking-wide bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          CONCORD
        </span>
      </div>

      {/* Right: Actions — hidden in compact mode */}
      {!compact && (
        <div className="flex items-center gap-1">
          {/* Webhost active indicator */}
          {webhostRunning && webhostInfo && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/10 text-secondary mr-1"
              title={`Sharing at ${webhostInfo.url} — ${webhostInfo.activeGuests} guest(s)`}
            >
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
              <span className="material-symbols-outlined text-base">cast</span>
              <span className="text-[10px] font-label font-bold">
                {webhostInfo.activeGuests}
              </span>
            </div>
          )}

          <button
            className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            title="Search"
          >
            <span className="material-symbols-outlined text-xl">search</span>
          </button>
          <button
            className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            title="Notifications"
          >
            <span className="material-symbols-outlined text-xl">notifications</span>
          </button>
          <button
            className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            title="Profile"
          >
            <span className="material-symbols-outlined text-xl">account_circle</span>
          </button>
        </div>
      )}
    </header>
  );
}

export default TopBar;
