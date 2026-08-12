/**
 * ReticulumInstanceInterfaces — the web Interfaces tab for the INSTANCE
 * pillar node (the docker deployment's own in-process RNS stack).
 *
 * Everyone sees the live interface list + LXMF propagation status from
 * `GET /api/reticulum/mesh`. Instance admins additionally get a real
 * editor for the pillar's OUTBOUND links (TCPClientInterface blocks in
 * the rnsd config) and the LXMF propagation toggle, saved via
 * `PUT /api/admin/reticulum`. Interface-set changes take effect after a
 * process restart (RNS reads its interfaces once at init) — the save
 * result surfaces that.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import { useInstanceAdmin } from "../layout/chatLayout/useInstanceAdmin";
import {
  fetchReticulumAdmin,
  fetchReticulumMesh,
  updateReticulumAdmin,
  type OutboundInterface,
  type ReticulumMeshSnapshot,
} from "../../api/reticulumAdmin";

function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

export function ReticulumInstanceInterfaces() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = useInstanceAdmin(accessToken);

  const [mesh, setMesh] = useState<ReticulumMeshSnapshot | null>(null);
  const [links, setLinks] = useState<OutboundInterface[]>([]);
  const [lxmfEnabled, setLxmfEnabled] = useState(true);
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMesh = useCallback(async () => {
    if (!accessToken) return;
    try {
      setMesh(await fetchReticulumMesh(accessToken));
    } catch {
      // node may be off — the empty state below covers it
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshMesh();
    const t = setInterval(() => void refreshMesh(), 15_000);
    return () => clearInterval(t);
  }, [refreshMesh]);

  useEffect(() => {
    if (!accessToken || !isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await fetchReticulumAdmin(accessToken);
        if (cancelled) return;
        setLinks(view.config.outbound_interfaces ?? []);
        setLxmfEnabled(view.config.lxmf_propagation_enabled);
        setAdminLoaded(true);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "admin config load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, isAdmin]);

  const mutateLink = (
    idx: number,
    patch: Partial<OutboundInterface>,
  ): void => {
    setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateReticulumAdmin(accessToken, {
        outbound_interfaces: links,
        lxmf_propagation_enabled: lxmfEnabled,
      });
      setDirty(false);
      setNotice(
        result.warning ??
          (result.restart_required
            ? "Saved. Interface changes apply after the instance restarts (rns reads interfaces at startup)."
            : "Saved and applied."),
      );
      void refreshMesh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const lxmf = mesh?.lxmf;

  return (
    <div
      className="max-w-2xl space-y-6"
      data-testid="reticulum-instance-interfaces"
    >
      {/* ── Live interfaces of the instance pillar ─────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-on-surface">
          Instance node interfaces
        </h3>
        <p className="text-xs text-on-surface-variant">
          This portal's own Reticulum pillar node. Live interfaces as the
          running RNS stack reports them.
        </p>
        {!mesh?.running ? (
          <p className="text-xs text-on-surface-variant">
            The instance pillar is not running
            {mesh?.mode ? ` (mode: ${mesh.mode})` : ""}. An instance admin can
            enable it below or via the admin settings.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {mesh.interfaces.map((iface) => (
              <li
                key={iface.name}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container"
              >
                <span className="material-symbols-outlined text-green-700 text-lg">
                  settings_ethernet
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-on-surface truncate">
                    {iface.name}
                  </div>
                  <div className="text-[11px] text-on-surface-variant">
                    rx {iface.rxb ?? 0} B · tx {iface.txb ?? 0} B
                  </div>
                </div>
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    iface.online ? "bg-green-500" : "bg-on-surface-variant/40"
                  }`}
                  aria-label={iface.online ? "Online" : "Offline"}
                />
              </li>
            ))}
          </ul>
        )}
        {lxmf && (
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                lxmf.running ? "bg-green-500" : "bg-on-surface-variant/40"
              }`}
            />
            LXMF propagation node:{" "}
            {lxmf.running
              ? `relaying (dest ${
                  lxmf.propagation_destination
                    ? shortHash(lxmf.propagation_destination)
                    : "…"
                })`
              : lxmf.enabled
                ? (lxmf.error ?? "starting…")
                : "disabled"}
          </div>
        )}
      </div>

      {/* ── Outbound links (admin editor / read-only hint) ─────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-on-surface">
          Outbound links
        </h3>
        <p className="text-xs text-on-surface-variant">
          TCP links this pillar dials out to (peer pillars, public Reticulum
          hubs). They extend the mesh this instance can see and route for.
        </p>

        {!isAdmin ? (
          <p className="text-xs text-on-surface-variant">
            Only instance admins can edit the pillar's outbound links. Live
            links appear in the interface list above once established.
          </p>
        ) : !adminLoaded ? (
          <p className="text-xs text-on-surface-variant">Loading…</p>
        ) : (
          <div className="space-y-2">
            {links.length === 0 && (
              <p className="text-xs text-on-surface-variant">
                No outbound links configured.
              </p>
            )}
            {links.map((link, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-surface-container"
                data-testid={`outbound-link-${idx}`}
              >
                <input
                  type="text"
                  value={link.name}
                  onChange={(e) => mutateLink(idx, { name: e.target.value })}
                  placeholder="Name"
                  className="w-32 bg-surface rounded-md px-2 py-1 text-sm text-on-surface"
                  aria-label="Link name"
                />
                <input
                  type="text"
                  value={link.target_host}
                  onChange={(e) =>
                    mutateLink(idx, { target_host: e.target.value })
                  }
                  placeholder="host.example.org"
                  className="flex-1 min-w-36 bg-surface rounded-md px-2 py-1 text-sm text-on-surface font-mono"
                  aria-label="Target host"
                />
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={link.target_port}
                  onChange={(e) =>
                    mutateLink(idx, {
                      target_port: Number(e.target.value) || 0,
                    })
                  }
                  className="w-24 bg-surface rounded-md px-2 py-1 text-sm text-on-surface font-mono"
                  aria-label="Target port"
                />
                <label className="flex items-center gap-1 text-xs text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={link.enabled}
                    onChange={(e) =>
                      mutateLink(idx, { enabled: e.target.checked })
                    }
                  />
                  on
                </label>
                <button
                  type="button"
                  title="Remove link"
                  onClick={() => {
                    setLinks((prev) => prev.filter((_, i) => i !== idx));
                    setDirty(true);
                  }}
                  className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-base">
                    delete
                  </span>
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setLinks((prev) => [
                    ...prev,
                    { name: "", target_host: "", target_port: 4242, enabled: true },
                  ]);
                  setDirty(true);
                }}
                className="btn-press text-xs px-3 py-1.5 rounded-lg bg-surface-container text-on-surface hover:bg-surface-container-high"
              >
                Add outbound link
              </button>
              <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={lxmfEnabled}
                  onChange={(e) => {
                    setLxmfEnabled(e.target.checked);
                    setDirty(true);
                    setNotice(null);
                  }}
                />
                LXMF propagation node
              </label>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void save()}
                className="btn-press text-xs px-3 py-1.5 rounded-lg bg-primary text-on-primary disabled:opacity-40"
                data-testid="outbound-links-save"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {notice && <p className="text-xs text-green-700">{notice}</p>}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
