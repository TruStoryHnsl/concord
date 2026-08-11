/**
 * ReticulumSidebar — the sidebar column for a Reticulum source.
 *
 * Not a channel list: Reticulum has no channels. Navigation follows the
 * framework's own sections — Network (topology), Announces, Interfaces —
 * driving `useReticulumSurfaceStore.tab`, which ReticulumSurface renders.
 */

import { useReticulumSurfaceStore, type ReticulumTab } from "../../stores/reticulumSurface";
import { useSourcesStore } from "../../stores/sources";

const SECTIONS: { id: ReticulumTab; icon: string; label: string; hint: string }[] = [
  { id: "network", icon: "lan", label: "Network", hint: "Topology map" },
  { id: "announces", icon: "podcasts", label: "Announces", hint: "Known destinations" },
  { id: "interfaces", icon: "settings_input_antenna", label: "Interfaces", hint: "rnsd links" },
];

export function ReticulumSidebar({
  onNavigate,
}: {
  /** Mobile: advance to the content pane after picking a section. */
  onNavigate?: () => void;
}) {
  const sourceId = useReticulumSurfaceStore((s) => s.sourceId);
  const tab = useReticulumSurfaceStore((s) => s.tab);
  const setTab = useReticulumSurfaceStore((s) => s.setTab);
  const source = useSourcesStore((s) =>
    sourceId ? s.sources.find((x) => x.id === sourceId) : undefined,
  );

  return (
    <div
      className="flex-1 flex flex-col bg-surface-container-low min-h-0"
      data-testid="reticulum-sidebar"
    >
      <div className="px-4 py-3 border-b border-outline-variant/20">
        <div className="text-sm font-semibold text-on-surface truncate">
          {source?.instanceName || "Reticulum"}
        </div>
        <div className="text-[11px] text-on-surface-variant">mesh source</div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setTab(s.id);
              onNavigate?.();
            }}
            data-testid={`reticulum-nav-${s.id}`}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
              tab === s.id
                ? "bg-green-700/15 text-on-surface"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            }`}
          >
            <span
              className={`material-symbols-outlined text-lg ${tab === s.id ? "text-green-700" : ""}`}
            >
              {s.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm">{s.label}</span>
              <span className="block text-[11px] opacity-70">{s.hint}</span>
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
