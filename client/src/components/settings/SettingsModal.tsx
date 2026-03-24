import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings";
import { useAuthStore } from "../../stores/auth";
import { checkAdmin } from "../../api/concord";
import { AudioTab } from "./AudioTab";
import { VoiceTab } from "./VoiceTab";
import { NotificationsTab } from "./NotificationsTab";
import { ProfileTab } from "./ProfileTab";
import { AboutTab } from "./AboutTab";
import { AdminTab } from "./AdminTab";

const baseTabs = [
  { key: "audio" as const, label: "Audio" },
  { key: "voice" as const, label: "Voice" },
  { key: "notifications" as const, label: "Notifications" },
  { key: "profile" as const, label: "Profile" },
  { key: "about" as const, label: "About" },
];

/**
 * Inline settings panel — renders inside the main content pane
 * (no overlay, no modal). ChatLayout shows this when settingsOpen is true.
 */
export function SettingsPanel() {
  const activeTab = useSettingsStore((s) => s.settingsTab);
  const setTab = useSettingsStore((s) => s.setSettingsTab);
  const close = useSettingsStore((s) => s.closeSettings);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    checkAdmin(accessToken).then((r) => setIsAdmin(r.is_admin)).catch(() => {});
  }, [accessToken]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);

  const tabs = isAdmin
    ? [...baseTabs, { key: "admin" as const, label: "Admin" }]
    : baseTabs;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        {activeTab === "audio" && <AudioTab />}
        {activeTab === "voice" && <VoiceTab />}
        {activeTab === "notifications" && <NotificationsTab />}
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "about" && <AboutTab />}
        {activeTab === "admin" && isAdmin && <AdminTab />}
      </div>
    </div>
  );
}
