import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings";
import { useServerStore } from "../../stores/server";

type NotifLevel = "all" | "mentions" | "nothing";

const levelLabels: Record<NotifLevel, string> = {
  all: "All Messages",
  mentions: "Mentions Only",
  nothing: "Nothing",
};

export function NotificationsTab() {
  const enabled = useSettingsStore((s) => s.notificationsEnabled);
  const setEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const defaultLevel = useSettingsStore((s) => s.defaultNotificationLevel);
  const setDefaultLevel = useSettingsStore((s) => s.setDefaultNotificationLevel);
  const notificationSound = useSettingsStore((s) => s.notificationSound);
  const setNotificationSound = useSettingsStore((s) => s.setNotificationSound);
  const serverNotifications = useSettingsStore((s) => s.serverNotifications);
  const setServerLevel = useSettingsStore((s) => s.setServerNotificationLevel);
  const servers = useServerStore((s) => s.servers);

  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-white">Notifications</h3>

      <div className="space-y-4">
        {/* Enable/disable toggle */}
        <ToggleRow
          label="Desktop Notifications"
          description="Show browser notifications for new messages when the tab is not focused"
          value={enabled}
          onChange={setEnabled}
        />

        {/* Sound toggle */}
        <ToggleRow
          label="Notification Sound"
          description="Play a chime when a notification fires"
          value={notificationSound}
          onChange={setNotificationSound}
        />

        {/* Permission status */}
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-zinc-400">Browser Permission</span>
          <span
            className={`text-sm ${
              permission === "granted"
                ? "text-emerald-400"
                : permission === "denied"
                  ? "text-red-400"
                  : "text-amber-400"
            }`}
          >
            {permission === "granted"
              ? "Granted"
              : permission === "denied"
                ? "Denied"
                : "Not requested"}
          </span>
        </div>

        {permission !== "granted" && (
          <button
            onClick={requestPermission}
            disabled={permission === "denied"}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors"
          >
            {permission === "denied"
              ? "Permission Denied (check browser settings)"
              : "Request Permission"}
          </button>
        )}

        {/* Default level */}
        <div className="pt-2 border-t border-zinc-700">
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Default Notification Level
          </label>
          <div className="flex gap-2">
            {(["all", "mentions", "nothing"] as const).map((level) => (
              <button
                key={level}
                onClick={() => setDefaultLevel(level)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  defaultLevel === level
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {levelLabels[level]}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Applied to all channels unless overridden per-server or per-channel.
          </p>
        </div>

        {/* Per-server overrides */}
        {servers.length > 0 && (
          <div className="pt-2 border-t border-zinc-700">
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Per-Server Overrides
            </label>
            <div className="space-y-1">
              {servers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-3 py-2 rounded bg-zinc-800/50"
                >
                  <span className="text-sm text-zinc-300">{s.name}</span>
                  <select
                    value={serverNotifications[s.id] ?? "default"}
                    onChange={(e) =>
                      setServerLevel(s.id, e.target.value as NotifLevel | "default")
                    }
                    className="text-xs bg-zinc-700 text-zinc-300 rounded px-2 py-1 border-none focus:outline-none"
                  >
                    <option value="default">Default ({levelLabels[defaultLevel]})</option>
                    <option value="all">All Messages</option>
                    <option value="mentions">Mentions Only</option>
                    <option value="nothing">Nothing</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          value ? "bg-indigo-600" : "bg-zinc-600"
        }`}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            value ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}
