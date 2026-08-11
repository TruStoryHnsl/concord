/**
 * ReticulumInterfacesPanel — manage the interfaces in Concord's isolated rnsd
 * config (R6).
 *
 * Renders inside the Reticulum connector row (native + compiled-in only). Lists
 * the configured interfaces with enable/edit/delete, and an add/edit form with
 * a type picker and per-type fields mirroring crosstalk's taxonomy:
 * TCPClientInterface (remote hub), TCPServerInterface (listener), AutoInterface
 * (LAN multicast), RNodeInterface (LoRa, opt-in). The mandatory loopback is
 * shown read-only (it can't be deleted).
 *
 * Matches the surrounding settings design: `bg-surface-container` cards,
 * `material-symbols-outlined` icons, `font-headline`/`font-label` type, and
 * pill primary buttons — the same language as the Meshtastic sub-panel above.
 */

import { useCallback, useEffect, useState } from "react";
import {
  addReticulumInterface,
  deleteReticulumInterface,
  listReticulumInterfaces,
  setReticulumInterfaceEnabled,
  updateReticulumInterface,
  RETICULUM_LOOPBACK_NAME,
  type ReticulumInterface,
  type ReticulumInterfaceType,
} from "../../api/reticulumInterfaces";

const TYPE_OPTIONS: { value: ReticulumInterfaceType; label: string }[] = [
  { value: "TCPClientInterface", label: "TCP client (connect to a hub)" },
  { value: "TCPServerInterface", label: "TCP server (listen)" },
  { value: "AutoInterface", label: "Auto (LAN multicast)" },
  { value: "RNodeInterface", label: "RNode (LoRa radio)" },
];

const DISCOVERY_SCOPES = ["link", "admin", "site", "organisation", "global"];

/** A row-editable draft: all values held as strings, coerced on submit. */
interface Draft {
  original: string | null; // name being edited (null = adding new)
  name: string;
  type: ReticulumInterfaceType;
  fields: Record<string, string>;
}

function emptyDraft(): Draft {
  return { original: null, name: "", type: "TCPClientInterface", fields: {} };
}

function draftFromInterface(i: ReticulumInterface): Draft {
  const fields: Record<string, string> = {};
  const put = (k: string, v: number | string | undefined) => {
    if (v !== undefined) fields[k] = String(v);
  };
  put("target_host", i.target_host);
  put("target_port", i.target_port);
  put("listen_ip", i.listen_ip);
  put("listen_port", i.listen_port);
  put("group_id", i.group_id);
  put("discovery_scope", i.discovery_scope);
  put("discovery_port", i.discovery_port);
  put("data_port", i.data_port);
  put("port", i.port);
  put("frequency", i.frequency);
  put("bandwidth", i.bandwidth);
  put("txpower", i.txpower);
  put("spreadingfactor", i.spreadingfactor);
  put("codingrate", i.codingrate);
  return { original: i.name, name: i.name, type: i.type, fields };
}

/** Field descriptors per interface type: [key, label, placeholder, numeric, required]. */
const FIELDS: Record<
  ReticulumInterfaceType,
  [string, string, string, boolean, boolean][]
> = {
  TCPClientInterface: [
    ["target_host", "Target host", "hub.example.net", false, true],
    ["target_port", "Target port", "4242", true, true],
  ],
  TCPServerInterface: [
    ["listen_ip", "Listen IP", "0.0.0.0", false, true],
    ["listen_port", "Listen port", "4242", true, true],
  ],
  AutoInterface: [
    ["group_id", "Group id (optional)", "concord", false, false],
    ["discovery_scope", "Discovery scope (optional)", "link", false, false],
    ["discovery_port", "Discovery port (optional)", "29716", true, false],
    ["data_port", "Data port (optional)", "42671", true, false],
  ],
  RNodeInterface: [
    ["port", "Serial port", "/dev/ttyUSB0", false, true],
    ["frequency", "Frequency (Hz)", "867200000", true, true],
    ["bandwidth", "Bandwidth (Hz)", "125000", true, true],
    ["txpower", "TX power (dBm)", "7", true, true],
    ["spreadingfactor", "Spreading factor", "8", true, true],
    ["codingrate", "Coding rate", "5", true, true],
  ],
};

function buildInterface(draft: Draft, enabled: boolean): ReticulumInterface | string {
  const name = draft.name.trim();
  if (!name) return "Name is required";
  const iface: Record<string, unknown> = { name, enabled, type: draft.type };
  for (const [key, label, , numeric, required] of FIELDS[draft.type]) {
    const raw = (draft.fields[key] ?? "").trim();
    if (!raw) {
      if (required) return `${label} is required`;
      continue;
    }
    if (numeric) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return `${label} must be a number`;
      iface[key] = n;
    } else {
      iface[key] = raw;
    }
  }
  return iface as unknown as ReticulumInterface;
}

export function ReticulumInterfacesPanel() {
  const [interfaces, setInterfaces] = useState<ReticulumInterface[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInterfaces(await listReticulumInterfaces());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = useCallback(
    async (i: ReticulumInterface) => {
      setBusy(i.name);
      setError(null);
      try {
        await setReticulumInterfaceEnabled(i.name, !i.enabled);
        await refresh();
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (i: ReticulumInterface) => {
      setBusy(i.name);
      setError(null);
      try {
        await deleteReticulumInterface(i.name);
        await refresh();
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const onSubmit = useCallback(async () => {
    if (!draft) return;
    const editing = draft.original !== null;
    // Preserve the enabled state when editing; new interfaces default enabled.
    const prev = interfaces.find((i) => i.name === draft.original);
    const built = buildInterface(draft, prev?.enabled ?? true);
    if (typeof built === "string") {
      setError(built);
      return;
    }
    setBusy("__form__");
    setError(null);
    try {
      if (editing) {
        await updateReticulumInterface(built);
      } else {
        await addReticulumInterface(built);
      }
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }, [draft, interfaces, refresh]);

  return (
    <div
      className="mt-1 pl-8 flex flex-col gap-2 border-t border-outline-variant/20 pt-2"
      data-testid="reticulum-interfaces-panel"
    >
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          Interfaces
        </label>
        {!draft && (
          <button
            type="button"
            data-testid="reticulum-interface-add-button"
            onClick={() => setDraft(emptyDraft())}
            className="text-xs font-label px-2.5 py-1 rounded-full bg-primary text-on-primary flex items-center gap-1"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "14px" }}
            >
              add
            </span>
            Add
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-on-surface-variant/60 font-label">Loading…</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {interfaces.map((i) => {
            const isLoopback = i.name === RETICULUM_LOOPBACK_NAME;
            return (
              <div
                key={i.name}
                data-testid={`reticulum-interface-${i.name}`}
                data-enabled={i.enabled}
                className="flex items-center gap-2 rounded-lg bg-surface-variant/30 px-2.5 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-headline font-medium text-on-surface truncate">
                      {i.name}
                    </span>
                    {isLoopback && (
                      <span className="text-[9px] font-label uppercase tracking-wide px-1 py-0.5 rounded bg-surface-variant/60 text-on-surface-variant/70">
                        default
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-label text-on-surface-variant/70">
                    {i.type}
                  </span>
                </div>

                {/* enable toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={i.enabled}
                  aria-label={`${i.enabled ? "Disable" : "Enable"} ${i.name}`}
                  data-testid={`reticulum-interface-toggle-${i.name}`}
                  disabled={busy === i.name}
                  onClick={() => onToggle(i)}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    i.enabled ? "bg-primary" : "bg-surface-variant"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-on-primary transition-transform ${
                      i.enabled ? "translate-x-4" : ""
                    }`}
                  />
                </button>

                {/* edit */}
                <button
                  type="button"
                  aria-label={`Edit ${i.name}`}
                  data-testid={`reticulum-interface-edit-${i.name}`}
                  disabled={busy === i.name}
                  onClick={() => setDraft(draftFromInterface(i))}
                  className="text-on-surface-variant hover:text-on-surface disabled:opacity-40"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "16px" }}
                  >
                    edit
                  </span>
                </button>

                {/* delete (not the loopback) */}
                {!isLoopback && (
                  <button
                    type="button"
                    aria-label={`Delete ${i.name}`}
                    data-testid={`reticulum-interface-delete-${i.name}`}
                    disabled={busy === i.name}
                    onClick={() => onDelete(i)}
                    className="text-on-surface-variant hover:text-error disabled:opacity-40"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "16px" }}
                    >
                      delete
                    </span>
                  </button>
                )}
              </div>
            );
          })}
          {interfaces.length === 0 && (
            <p className="text-[10px] font-label text-on-surface-variant/60">
              No interfaces configured.
            </p>
          )}
        </div>
      )}

      {/* add / edit form */}
      {draft && (
        <div
          className="flex flex-col gap-2 rounded-lg bg-surface-variant/20 p-2.5 mt-1"
          data-testid="reticulum-interface-form"
        >
          <input
            type="text"
            value={draft.name}
            disabled={draft.original !== null}
            data-testid="reticulum-interface-form-name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Interface name"
            className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface disabled:opacity-60"
          />
          <select
            value={draft.type}
            data-testid="reticulum-interface-form-type"
            onChange={(e) =>
              setDraft({
                ...draft,
                type: e.target.value as ReticulumInterfaceType,
                fields: {},
              })
            }
            className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {FIELDS[draft.type].map(([key, label, placeholder, numeric]) =>
            key === "discovery_scope" ? (
              <select
                key={key}
                value={draft.fields[key] ?? ""}
                data-testid={`reticulum-interface-form-${key}`}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fields: { ...draft.fields, [key]: e.target.value },
                  })
                }
                className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface"
              >
                <option value="">{label}</option>
                {DISCOVERY_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input
                key={key}
                type={numeric ? "number" : "text"}
                value={draft.fields[key] ?? ""}
                placeholder={`${label} (${placeholder})`}
                data-testid={`reticulum-interface-form-${key}`}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fields: { ...draft.fields, [key]: e.target.value },
                  })
                }
                className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface"
              />
            ),
          )}

          {draft.type === "RNodeInterface" && (
            <p className="text-[10px] font-label text-on-surface-variant/60">
              LoRa radios are off until you add and enable one. Requires a
              physical RNode on the serial port; hardware verification is
              deferred.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="reticulum-interface-form-save"
              disabled={busy === "__form__"}
              onClick={onSubmit}
              className="text-xs font-label px-3 py-1 rounded-full bg-primary text-on-primary disabled:opacity-50"
            >
              {draft.original !== null ? "Save" : "Add"}
            </button>
            <button
              type="button"
              data-testid="reticulum-interface-form-cancel"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="text-xs font-label px-3 py-1 rounded-full bg-surface-variant text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          className="text-[10px] font-label text-error"
          data-testid="reticulum-interface-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
