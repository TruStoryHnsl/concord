import { useState, useRef, useEffect } from "react";
import { useWebhostStore } from "@/stores/webhost";
import { useFriendsStore } from "@/stores/friends";
import type { PresenceStatus } from "@/api/tauri";

interface TopBarProps {
  compact?: boolean;
}

const PRESENCE_OPTIONS: { status: PresenceStatus; label: string; color: string; icon: string }[] = [
  { status: "online", label: "Online", color: "bg-secondary", icon: "circle" },
  { status: "away", label: "Away", color: "bg-[#f59e0b]", icon: "dark_mode" },
  { status: "dnd", label: "Do Not Disturb", color: "bg-error", icon: "do_not_disturb_on" },
  { status: "offline", label: "Invisible", color: "bg-outline-variant", icon: "visibility_off" },
];

function TopBar({ compact = false }: TopBarProps) {
  const webhostRunning = useWebhostStore((s) => s.isRunning);
  const webhostInfo = useWebhostStore((s) => s.info);
  const myPresence = useFriendsStore((s) => s.myPresence);
  const setMyPresence = useFriendsStore((s) => s.setMyPresence);
  const [showPresenceMenu, setShowPresenceMenu] = useState(false);
  const presenceRef = useRef<HTMLDivElement>(null);

  // Close presence menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (presenceRef.current && !presenceRef.current.contains(e.target as Node)) {
        setShowPresenceMenu(false);
      }
    }
    if (showPresenceMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showPresenceMenu]);

  const currentPresence = PRESENCE_OPTIONS.find((p) => p.status === myPresence) ?? PRESENCE_OPTIONS[0]!;

  return (
    <header className="flex items-center justify-between h-12 px-4 bg-surface-container-low border-b border-outline-variant/30 shrink-0">
      {/* Left: Logo & title */}
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-2xl">hub</span>
        <span className="font-headline font-bold text-lg tracking-wide bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          CONCORD
        </span>
      </div>

      {/* Right: Actions -- hidden in compact mode */}
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

          {/* Presence status selector */}
          <div className="relative" ref={presenceRef}>
            <button
              onClick={() => setShowPresenceMenu(!showPresenceMenu)}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors relative"
              title={`Status: ${currentPresence.label}`}
            >
              <span className="material-symbols-outlined text-xl">account_circle</span>
              <span
                className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border-2 border-surface-container-low ${currentPresence.color}`}
              />
            </button>

            {/* Presence dropdown */}
            {showPresenceMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 glass-panel rounded-xl py-1 z-50">
                {PRESENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.status}
                    onClick={() => {
                      setMyPresence(opt.status);
                      setShowPresenceMenu(false);
                    }}
                    className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm font-label hover:bg-surface-container-high/50 transition-colors ${
                      myPresence === opt.status ? "text-on-surface" : "text-on-surface-variant"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                    <span>{opt.label}</span>
                    {myPresence === opt.status && (
                      <span className="material-symbols-outlined text-sm text-primary ml-auto">
                        check
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default TopBar;
