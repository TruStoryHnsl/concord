/**
 * ConnectorsTab — external-mesh connectors menu (F7 / W2.4).
 *
 * Lists the external-mesh connectors (Reticulum, Meshtastic, LoRa) with an
 * enable/disable toggle and per-connector config. Enabling a connector
 * registers its `MeshLayer`, which flips the matching toggle in the mesh
 * map's `LayerToggles` to available and wires its nodes/edges into the
 * shared `MeshCanvas`.
 *
 * Native-only surface: connectors run inside the desktop/mobile swarm, so on
 * web this renders a "web mode" notice. A connector whose native Cargo
 * feature wasn't compiled in shows a "not in this build" state.
 */

import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../../api/servitude";
import {
  listConnectors,
  setConnectorEnabled,
  setMeshtasticInterface,
  type ConnectorDescriptor,
  type MeshtasticInterfaceKind,
} from "../../api/connectors";

export function ConnectorsTab() {
  const native = isTauri();
  const [connectors, setConnectors] = useState<ConnectorDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Meshtastic interface selection (UI state mirrored to native on apply).
  const [mtKind, setMtKind] = useState<MeshtasticInterfaceKind>("tcp");
  const [mtTarget, setMtTarget] = useState("");
  const [mtPort, setMtPort] = useState(4403);

  const refresh = useCallback(async () => {
    try {
      setConnectors(await listConnectors());
    } catch {
      // listConnectors already falls back to the catalog on error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = useCallback(
    async (c: ConnectorDescriptor) => {
      if (!c.compiledIn) return;
      setBusyId(c.id);
      try {
        await setConnectorEnabled(c.id, !c.enabled);
        await refresh();
      } catch (err) {
        console.warn("[connectors] toggle failed:", err);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const onApplyMeshtastic = useCallback(async () => {
    setBusyId("meshtastic");
    try {
      await setMeshtasticInterface({
        kind: mtKind,
        target: mtTarget.trim() || undefined,
        port: mtKind === "tcp" ? mtPort : undefined,
        baud: mtKind === "serial" ? 115200 : undefined,
      });
    } catch (err) {
      console.warn("[connectors] meshtastic interface apply failed:", err);
    } finally {
      setBusyId(null);
    }
  }, [mtKind, mtTarget, mtPort]);

  if (!native) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-2">
        <span
          className="material-symbols-outlined text-on-surface-variant/50"
          style={{ fontSize: "40px" }}
        >
          device_hub
        </span>
        <p className="text-sm text-on-surface-variant font-body">
          Connectors run on the native app
        </p>
        <p className="text-xs text-on-surface-variant/60 font-label max-w-xs">
          External-mesh connectors (Reticulum, Meshtastic, LoRa) live in the
          desktop and mobile swarm. The browser can&apos;t drive a radio.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="connectors-tab">
      <div>
        <h3 className="text-sm font-headline font-semibold text-on-surface mb-1">
          External-mesh connectors
        </h3>
        <p className="text-xs text-on-surface-variant font-label">
          Bridge Concord onto external meshes. Each enabled connector adds its
          own layer to the mesh map.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-on-surface-variant/60 font-label">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {connectors.map((c) => (
            <div
              key={c.id}
              data-testid={`connector-row-${c.id}`}
              data-connector-enabled={c.enabled}
              data-connector-compiled={c.compiledIn}
              className="p-3 rounded-xl bg-surface-container flex flex-col gap-2"
            >
              <div className="flex items-start gap-3">
                <span
                  className="material-symbols-outlined text-on-surface-variant mt-0.5"
                  style={{ fontSize: "20px" }}
                >
                  {c.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-headline font-medium text-on-surface">
                      {c.label}
                    </span>
                    {!c.compiledIn && (
                      <span className="text-[10px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-variant/50 text-on-surface-variant/70">
                        not in this build
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant font-label mt-0.5">
                    {c.description}
                  </p>
                </div>
                {/* Enable/disable toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.enabled}
                  aria-label={`${c.enabled ? "Disable" : "Enable"} ${c.label}`}
                  data-testid={`connector-toggle-${c.id}`}
                  disabled={!c.compiledIn || busyId === c.id}
                  onClick={() => onToggle(c)}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                    !c.compiledIn
                      ? "bg-outline-variant/30 cursor-not-allowed opacity-50"
                      : c.enabled
                        ? "bg-primary"
                        : "bg-surface-variant"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-on-primary transition-transform ${
                      c.enabled ? "translate-x-4" : ""
                    }`}
                  />
                </button>
              </div>

              {/* Meshtastic device interface config — only when this row is
                  the Meshtastic connector and it's compiled in. */}
              {c.id === "meshtastic" && c.compiledIn && (
                <div className="mt-1 pl-8 flex flex-col gap-2 border-t border-outline-variant/20 pt-2">
                  <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    Device interface
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      data-testid="meshtastic-interface-kind"
                      value={mtKind}
                      onChange={(e) =>
                        setMtKind(e.target.value as MeshtasticInterfaceKind)
                      }
                      className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface"
                    >
                      <option value="tcp">TCP (networked node)</option>
                      <option value="ble">BLE (mobile) — needs device</option>
                      <option value="serial">
                        USB serial (desktop) — needs device
                      </option>
                    </select>
                    <input
                      data-testid="meshtastic-interface-target"
                      type="text"
                      value={mtTarget}
                      onChange={(e) => setMtTarget(e.target.value)}
                      placeholder={
                        mtKind === "tcp"
                          ? "host or IP"
                          : mtKind === "serial"
                            ? "/dev/ttyUSB0 (blank = auto)"
                            : "BLE name (blank = first found)"
                      }
                      className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface flex-1 min-w-[120px]"
                    />
                    {mtKind === "tcp" && (
                      <input
                        data-testid="meshtastic-interface-port"
                        type="number"
                        value={mtPort}
                        onChange={(e) =>
                          setMtPort(Number(e.target.value) || 4403)
                        }
                        className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface w-20"
                      />
                    )}
                    <button
                      type="button"
                      data-testid="meshtastic-interface-apply"
                      disabled={busyId === "meshtastic"}
                      onClick={onApplyMeshtastic}
                      className="text-xs font-label px-3 py-1 rounded-full bg-primary text-on-primary disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                  {mtKind !== "tcp" && (
                    <p className="text-[10px] font-label text-on-surface-variant/60">
                      BLE and USB serial need a physical Meshtastic device.
                      Hardware verification is deferred; TCP works against a
                      networked node today.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
