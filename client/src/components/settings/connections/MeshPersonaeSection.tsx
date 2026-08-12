/**
 * MeshPersonaeSection — the docker half of the superuser protocol.
 *
 * On native, the superuser is a device-local root identity that derives
 * peer-facing personae. The docker instance is a PORTAL: an account
 * connects its superuser to the personae known on this instance by
 * CLAIMING them here (`POST /api/me/personas`). Bindings scope every
 * mesh read to the caller — the relay mailbox, deposit receipts, and
 * mesh message history all key off the personae bound to this account,
 * so until a persona is claimed the reticulum Messages surface has
 * nothing user-specific to show.
 *
 * One persona ↔ one account: the first authenticated claim wins and a
 * claim on a persona bound to a different account is rejected (409).
 * Releasing a binding frees the persona for another account.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../../../stores/auth";
import { getApiBase } from "../../../api/serverUrl";
import {
  claimPersona,
  listMyPersonas,
  releasePersona,
  type RemotePersonaBinding,
} from "../../../api/userSources";

export function MeshPersonaeSection() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [bindings, setBindings] = useState<RemotePersonaBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [personaId, setPersonaId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const rows = await listMyPersonas(getApiBase(), accessToken);
      setBindings(Array.isArray(rows) ? rows : []);
    } catch {
      // Portal unreachable — keep whatever we last showed.
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClaim = async () => {
    const id = personaId.trim();
    if (!id || !accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await claimPersona(getApiBase(), accessToken, {
        persona_id: id,
        label: label.trim() || undefined,
      });
      setPersonaId("");
      setLabel("");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /409|bound|conflict/i.test(msg)
          ? "That persona is already connected to a different account."
          : `Claim failed: ${msg}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRelease = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await releasePersona(getApiBase(), accessToken, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" data-testid="mesh-personae-section">
      <div>
        <h4 className="text-base font-semibold text-on-surface">
          Mesh personae
        </h4>
        <p className="text-sm text-on-surface-variant mt-1">
          Connect your superuser's personae to this account. A bound
          persona scopes the mesh to you — your relay mailbox, deposit
          receipts, and message history on the Reticulum surface all
          follow the personae connected here. One persona belongs to one
          account; the first claim wins.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : bindings.length === 0 ? (
        <p className="text-sm text-on-surface-variant italic">
          No personae connected yet.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="mesh-personae-list">
          {bindings.map((b) => (
            <li
              key={b.persona_id}
              className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2"
            >
              <span className="material-symbols-outlined text-green-700 text-xl">
                fingerprint
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm text-on-surface">
                  {b.persona_id}
                </span>
                {b.label ? (
                  <span className="block truncate text-xs text-on-surface-variant">
                    {b.label}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRelease(b.persona_id)}
                className="text-xs text-on-surface-variant hover:text-danger transition-colors disabled:opacity-50"
              >
                Release
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
          placeholder="persona id"
          className="flex-1 rounded-lg bg-surface-container px-3 py-2 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary"
          data-testid="mesh-persona-id-input"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label (optional)"
          className="flex-1 rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          disabled={busy || !personaId.trim()}
          onClick={() => void handleClaim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
          data-testid="mesh-persona-claim"
        >
          Connect
        </button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}
