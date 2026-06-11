/**
 * S4 — Community extension repository browser.
 *
 * Browse / search / install / update / remove extensions across the user's
 * configured repos (`repoStore`), tabbed by repo (the pinned default first).
 * Reuses the extension-store grid look from {@link ExtensionLibraryPanel}.
 *
 * Trust (S5): each repo tab carries a verified/unverified badge; adding a
 * repo whose signature does not verify against the bundled key pops a
 * warning sheet before persisting. Signing never blocks install.
 *
 * Install hands the EXISTING pipeline a bundle URL + integrity:
 *   POST /api/extensions/install { remote_url: bundle_url, integrity }
 * Install/uninstall stay admin-only (button disabled + tooltip for
 * non-admins); managing the repo LIST is a per-user pref, no admin gate.
 *
 * Full browse → install → run end-to-end is the S6 acceptance gate; this
 * component wires the UI + calls but that flow is verified in a later round.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { useExtensionStore } from "../../stores/extension";
import {
  useRepoStore,
  normalizeBaseUrl,
  probeRepoIndex,
  computeVerified,
  type RepoExtension,
  type ExtensionRepo,
} from "../../stores/repoStore";
import {
  installExtensionFromUrl,
  uninstallExtensionById,
  adminGetExtensionCatalog,
} from "../../api/concord";
import { compareVersions } from "../../utils/version";

/* Running Concord version — used to pick the newest compatible version of
 * an extension (one whose min_concord_version <= running). */
function runningConcordVersion(): string {
  return (
    (import.meta as unknown as { env?: { VITE_CONCORD_VERSION?: string } }).env
      ?.VITE_CONCORD_VERSION ?? "0.0.0"
  );
}

/** Newest version entry compatible with the running Concord version. */
export function pickInstallableVersion(ext: RepoExtension): RepoExtension["versions"][number] | null {
  const running = runningConcordVersion();
  // versions[] is newest-first; pick the first whose min_concord_version
  // is satisfied. Entries without a min are always eligible.
  for (const v of ext.versions) {
    const min = v.min_concord_version;
    if (!min || compareVersions(running, min) >= 0) return v;
  }
  return null;
}

interface TrustBadgeProps {
  verified: boolean;
}

function TrustBadge({ verified }: TrustBadgeProps) {
  return verified ? (
    <span
      data-testid="repo-badge-verified"
      title="Signed by the bundled Concord key"
      className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-primary font-label"
    >
      <span className="material-symbols-outlined text-sm">verified</span>
      verified
    </span>
  ) : (
    <span
      data-testid="repo-badge-unverified"
      title="Community repository — not signed by the bundled key. The sandbox is identical, but provenance is unverified."
      className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-on-surface-variant/80 font-label"
    >
      <span className="material-symbols-outlined text-sm">help</span>
      unverified
    </span>
  );
}

/* ── Add-repo warning sheet (S5) ────────────────────────────────── */

interface PendingAdd {
  baseUrl: string;
  name: string;
  maintainer?: string;
  extCount: number;
  verified: boolean;
}

function AddRepoSheet({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingAdd;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm repository"
      data-testid="add-repo-sheet"
    >
      <div className="w-full max-w-md mx-4 bg-surface-container rounded-2xl border border-outline-variant/20 shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-on-surface-variant">hub</span>
          <h3 className="text-base font-headline font-semibold text-on-surface flex-1">
            Add repository
          </h3>
          <TrustBadge verified={pending.verified} />
        </div>
        <div className="text-sm text-on-surface space-y-1">
          <p className="font-medium">{pending.name}</p>
          <p className="text-xs text-on-surface-variant font-mono break-all">
            {pending.baseUrl}
          </p>
          <p className="text-xs text-on-surface-variant">
            {pending.maintainer ? `Maintainer: ${pending.maintainer} · ` : ""}
            {pending.extCount} extension{pending.extCount === 1 ? "" : "s"}
          </p>
        </div>
        {!pending.verified && (
          <div
            data-testid="add-repo-unverified-warning"
            className="p-3 rounded border border-tertiary/40 bg-tertiary/10 text-xs text-on-surface"
          >
            This is a <strong>community repository</strong>. Its index is not
            signed by the bundled Concord key, so its provenance cannot be
            verified. Extensions still run in the same sandbox as any other —
            but only add repositories you trust.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            data-testid="add-repo-confirm"
            className="px-3 py-1.5 text-xs rounded primary-glow hover:brightness-110 text-on-surface transition-colors"
          >
            Add repository
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main browser ───────────────────────────────────────────────── */

export function ExtensionRepoBrowser({ onClose }: { onClose: () => void }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);

  const repos = useRepoStore((s) => s.repos);
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const refreshRepo = useRepoStore((s) => s.refreshRepo);
  const addRepoToStore = useRepoStore.getState().addRepo;

  const installedIds = useExtensionStore((s) =>
    new Set(s.catalog.map((e) => e.id)),
  );
  const reloadCatalog = useExtensionStore((s) => s.reloadCatalog);

  const [isAdmin, setIsAdmin] = useState(false);
  /** id → installed version, sourced from the admin catalog (admins only). */
  const [installedVersions, setInstalledVersions] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>(
    repos[0]?.baseUrl ?? "",
  );
  const [query, setQuery] = useState("");
  const [detailExtId, setDetailExtId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Determine admin once — install/uninstall buttons gate on this. Also
  // pull installed_versions for the update badge (admins only; non-admins
  // can't act on updates anyway).
  useEffect(() => {
    if (!accessToken) return;
    void adminGetExtensionCatalog(accessToken)
      .then((res) => {
        setIsAdmin(true);
        setInstalledVersions(res.installed_versions ?? {});
      })
      .catch(() => setIsAdmin(false));
  }, [accessToken]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-refresh repos that have no cached index yet (e.g. after a reload
  // dropped persisted indexes). Fire-and-forget; per-repo errors land in
  // the repo.error field surfaced in the tab body.
  useEffect(() => {
    for (const repo of repos) {
      if (repo.index === null && !repo.error) {
        void refreshRepo(repo.baseUrl).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active tab valid if a repo was removed.
  useEffect(() => {
    if (!repos.some((r) => r.baseUrl === activeTab) && repos[0]) {
      setActiveTab(repos[0].baseUrl);
    }
  }, [repos, activeTab]);

  const activeRepo: ExtensionRepo | undefined = repos.find(
    (r) => r.baseUrl === activeTab,
  );

  const visibleExtensions = useMemo(() => {
    const list = activeRepo?.index?.extensions ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((ext) =>
      [ext.name, ext.summary ?? "", ext.author ?? "", (ext.tags ?? []).join(" "), ext.id]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [activeRepo, query]);

  const detailExt = useMemo(
    () => visibleExtensions.find((e) => e.id === detailExtId) ?? null,
    [visibleExtensions, detailExtId],
  );

  /* ── Actions ──────────────────────────────────────────────────── */

  const handleInstall = async (ext: RepoExtension) => {
    if (!accessToken || !isAdmin) return;
    const version = pickInstallableVersion(ext);
    if (!version) {
      addToast(`${ext.name}: no version compatible with this Concord build`, "error");
      return;
    }
    setBusyId(ext.id);
    try {
      await installExtensionFromUrl(version.bundle_url, accessToken, version.integrity);
      addToast(`Installed ${ext.name} v${version.version}`, "success");
      await reloadCatalog(accessToken);
      const res = await adminGetExtensionCatalog(accessToken).catch(() => null);
      if (res) setInstalledVersions(res.installed_versions ?? {});
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Install failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async (ext: RepoExtension) => {
    if (!accessToken || !isAdmin) return;
    setBusyId(ext.id);
    try {
      await uninstallExtensionById(ext.id, accessToken);
      addToast(`Uninstalled ${ext.name}`, "success");
      await reloadCatalog(accessToken);
      const res = await adminGetExtensionCatalog(accessToken).catch(() => null);
      if (res) setInstalledVersions(res.installed_versions ?? {});
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Uninstall failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleProbeAdd = async () => {
    const baseUrl = normalizeBaseUrl(addUrl);
    if (!baseUrl) return;
    if (repos.some((r) => r.baseUrl === baseUrl)) {
      addToast("Repository already added", "info");
      return;
    }
    setAdding(true);
    try {
      const index = await probeRepoIndex(baseUrl);
      const verified = await computeVerified(index);
      // Show the trust/confirmation sheet before persisting.
      setPendingAdd({
        baseUrl,
        name: index.name,
        maintainer: index.maintainer,
        extCount: index.extensions.length,
        verified,
      });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not reach repository", "error");
    } finally {
      setAdding(false);
    }
  };

  const handleConfirmAdd = async () => {
    if (!pendingAdd) return;
    try {
      const repo = await addRepoToStore(pendingAdd.baseUrl);
      addToast(`Added ${repo.name}`, "success");
      setActiveTab(repo.baseUrl);
      setAddUrl("");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to add repository", "error");
    } finally {
      setPendingAdd(null);
    }
  };

  const handleRemoveRepo = (baseUrl: string) => {
    try {
      removeRepo(baseUrl);
      addToast("Repository removed", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Cannot remove repository", "error");
    }
  };

  const handleRefresh = async () => {
    if (!activeRepo) return;
    setRefreshing(true);
    try {
      await refreshRepo(activeRepo.baseUrl);
    } catch {
      /* error surfaced via repo.error */
    } finally {
      setRefreshing(false);
    }
  };

  const installTooltip = isAdmin
    ? undefined
    : "Only server admins can install or remove extensions";

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="extension-repo-browser"
      role="dialog"
      aria-modal="true"
      aria-label="Extensions"
    >
      <div className="w-full max-w-3xl mx-4 bg-surface-container rounded-2xl border border-outline-variant/20 shadow-2xl p-5 max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-surface-container-high ring-1 ring-outline-variant/15 flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant">extension</span>
          </div>
          <h2 className="flex-1 text-lg font-headline font-semibold text-on-surface">
            Extensions
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="repo-browser-close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Repo tabs (default first) */}
        <div className="flex items-center gap-1 mb-3 flex-wrap flex-shrink-0">
          {repos.map((repo) => (
            <button
              key={repo.baseUrl}
              onClick={() => {
                setActiveTab(repo.baseUrl);
                setDetailExtId(null);
              }}
              data-testid={`repo-tab-${repo.repoId}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-label font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === repo.baseUrl
                  ? "bg-surface-container-highest text-on-surface"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              {repo.pinned && (
                <span className="material-symbols-outlined text-sm">push_pin</span>
              )}
              <span className="truncate max-w-[10rem]">{repo.name}</span>
              <TrustBadge verified={repo.verified} />
            </button>
          ))}
        </div>

        {/* Add-repo row */}
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <input
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleProbeAdd();
            }}
            placeholder="Add a repository by base URL…"
            data-testid="add-repo-input"
            className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-surface-container-high border border-outline-variant/15 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <button
            onClick={() => void handleProbeAdd()}
            disabled={adding || !addUrl.trim()}
            data-testid="add-repo-probe"
            className="px-3 py-1.5 text-xs rounded-lg bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-40 text-on-surface transition-colors"
          >
            {adding ? "…" : "Add"}
          </button>
        </div>

        {/* Active repo toolbar */}
        {activeRepo && (
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${activeRepo.name}…`}
              data-testid="repo-search-input"
              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-surface-container-high border border-outline-variant/15 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              title="Refresh"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40 transition-colors"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
            </button>
            {!activeRepo.pinned && (
              <button
                onClick={() => handleRemoveRepo(activeRepo.baseUrl)}
                title="Remove repository"
                data-testid="repo-remove"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
              >
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {!isAdmin && (
            <div className="mb-2 p-2 rounded border border-outline-variant/20 bg-surface-container-high/40 text-[11px] text-on-surface-variant">
              You can browse and manage repositories, but only server admins
              can install or remove extensions.
            </div>
          )}

          {activeRepo?.error && (
            <div className="p-3 rounded border border-error/40 bg-error/10 text-sm text-error mb-2">
              {activeRepo.error}
              <button onClick={() => void handleRefresh()} className="ml-3 underline">
                Retry
              </button>
            </div>
          )}

          {activeRepo && !activeRepo.index && !activeRepo.error && (
            <p className="text-sm text-on-surface-variant">Loading repository…</p>
          )}

          {activeRepo?.index && visibleExtensions.length === 0 && (
            <p className="text-sm text-on-surface-variant">
              {query ? "No extensions match your search." : "This repository is empty."}
            </p>
          )}

          {/* Detail view */}
          {detailExt && (
            <ExtensionDetail
              ext={detailExt}
              installed={installedIds.has(detailExt.id)}
              installedVersion={installedVersions[detailExt.id]}
              isAdmin={isAdmin}
              busy={busyId === detailExt.id}
              installTooltip={installTooltip}
              onBack={() => setDetailExtId(null)}
              onInstall={() => void handleInstall(detailExt)}
              onUninstall={() => void handleUninstall(detailExt)}
            />
          )}

          {/* Grid */}
          {!detailExt && activeRepo?.index && visibleExtensions.length > 0 && (
            <ul className="space-y-2">
              {visibleExtensions.map((ext) => {
                const installed = installedIds.has(ext.id);
                const instVer = installedVersions[ext.id];
                const updateAvailable =
                  installed &&
                  instVer !== undefined &&
                  instVer !== "" &&
                  compareVersions(ext.latest, instVer) > 0;
                const isBusy = busyId === ext.id;
                return (
                  <li
                    key={ext.id}
                    data-testid={`repo-ext-row-${ext.id}`}
                    className="bg-surface-container rounded-lg p-3 border border-outline-variant/15"
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => setDetailExtId(ext.id)}
                        className="w-10 h-10 rounded-lg bg-surface-container-high ring-1 ring-outline-variant/15 flex items-center justify-center flex-shrink-0"
                      >
                        <span className="material-symbols-outlined text-on-surface-variant">
                          {ext.icon && !ext.icon.includes("/") ? ext.icon : "extension"}
                        </span>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => setDetailExtId(ext.id)}
                            className="text-sm font-medium text-on-surface hover:underline text-left"
                          >
                            {ext.name}
                          </button>
                          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-label">
                            v{ext.latest}
                          </span>
                          {installed && !updateAvailable && (
                            <span className="text-[10px] uppercase tracking-wider text-primary font-label">
                              installed
                            </span>
                          )}
                          {updateAvailable && (
                            <span
                              data-testid={`repo-update-badge-${ext.id}`}
                              className="text-[10px] uppercase tracking-wider text-tertiary font-label"
                            >
                              update: v{instVer} → v{ext.latest}
                            </span>
                          )}
                        </div>
                        {ext.summary && (
                          <p className="text-xs text-on-surface-variant mt-1 break-words">
                            {ext.summary}
                          </p>
                        )}
                        <p className="text-[11px] text-on-surface-variant/60 mt-1 font-mono">
                          {ext.id}
                        </p>
                      </div>
                      <div className="flex-shrink-0 flex flex-col gap-1.5 items-end">
                        {!installed && (
                          <button
                            onClick={() => void handleInstall(ext)}
                            disabled={isBusy || !isAdmin}
                            title={installTooltip}
                            data-testid={`repo-install-${ext.id}`}
                            className="px-3 py-1.5 text-xs rounded primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface transition-colors"
                          >
                            {isBusy ? "…" : "Install"}
                          </button>
                        )}
                        {updateAvailable && (
                          <button
                            onClick={() => void handleInstall(ext)}
                            disabled={isBusy || !isAdmin}
                            title={installTooltip}
                            className="px-3 py-1.5 text-xs rounded bg-tertiary/25 hover:bg-tertiary/35 disabled:opacity-40 text-tertiary transition-colors"
                          >
                            {isBusy ? "…" : "Update"}
                          </button>
                        )}
                        {installed && (
                          <button
                            onClick={() => void handleUninstall(ext)}
                            disabled={isBusy || !isAdmin}
                            title={installTooltip}
                            data-testid={`repo-uninstall-${ext.id}`}
                            className="px-2.5 py-1 text-[11px] rounded bg-error/15 hover:bg-error/25 disabled:opacity-40 text-error transition-colors"
                          >
                            {isBusy ? "…" : "Uninstall"}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {pendingAdd && (
        <AddRepoSheet
          pending={pendingAdd}
          onConfirm={() => void handleConfirmAdd()}
          onCancel={() => setPendingAdd(null)}
        />
      )}
    </div>
  );
}

/* ── Detail view (permissions from the version entry) ───────────── */

function ExtensionDetail({
  ext,
  installed,
  installedVersion,
  isAdmin,
  busy,
  installTooltip,
  onBack,
  onInstall,
  onUninstall,
}: {
  ext: RepoExtension;
  installed: boolean;
  installedVersion?: string;
  isAdmin: boolean;
  busy: boolean;
  installTooltip?: string;
  onBack: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const target = pickInstallableVersion(ext) ?? ext.versions[0];
  const updateAvailable =
    installed &&
    installedVersion !== undefined &&
    installedVersion !== "" &&
    compareVersions(ext.latest, installedVersion) > 0;

  return (
    <div data-testid={`repo-ext-detail-${ext.id}`} className="space-y-3">
      <button
        onClick={onBack}
        className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        Back
      </button>

      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-surface-container-high ring-1 ring-outline-variant/15 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-on-surface-variant text-2xl">
            {ext.icon && !ext.icon.includes("/") ? ext.icon : "extension"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-on-surface">{ext.name}</p>
          {ext.author && (
            <p className="text-xs text-on-surface-variant">by {ext.author}</p>
          )}
          <p className="text-[11px] text-on-surface-variant/60 font-mono mt-0.5">{ext.id}</p>
        </div>
        <div className="flex flex-col gap-1.5 items-end flex-shrink-0">
          {!installed && (
            <button
              onClick={onInstall}
              disabled={busy || !isAdmin}
              title={installTooltip}
              className="px-3 py-1.5 text-xs rounded primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface transition-colors"
            >
              {busy ? "…" : `Install v${target?.version ?? ext.latest}`}
            </button>
          )}
          {updateAvailable && (
            <button
              onClick={onInstall}
              disabled={busy || !isAdmin}
              title={installTooltip}
              className="px-3 py-1.5 text-xs rounded bg-tertiary/25 hover:bg-tertiary/35 disabled:opacity-40 text-tertiary transition-colors"
            >
              {busy ? "…" : `Update → v${ext.latest}`}
            </button>
          )}
          {installed && (
            <button
              onClick={onUninstall}
              disabled={busy || !isAdmin}
              title={installTooltip}
              className="px-2.5 py-1 text-[11px] rounded bg-error/15 hover:bg-error/25 disabled:opacity-40 text-error transition-colors"
            >
              {busy ? "…" : "Uninstall"}
            </button>
          )}
        </div>
      </div>

      {ext.summary && <p className="text-sm text-on-surface-variant">{ext.summary}</p>}

      {ext.tags && ext.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ext.tags.map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 text-[10px] rounded-full bg-surface-container-high text-on-surface-variant"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Permissions — advisory copy from the index version entry. The
          bundle manifest is authoritative; the server re-validates at
          install. */}
      <div>
        <h4 className="text-xs font-semibold text-on-surface mb-1">Permissions</h4>
        {target?.permissions && target.permissions.length > 0 ? (
          <ul className="space-y-0.5">
            {target.permissions.map((p) => (
              <li
                key={p}
                className="text-xs text-on-surface-variant font-mono flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm text-on-surface-variant/60">
                  key
                </span>
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-on-surface-variant/70">
            No permissions declared in the index.
          </p>
        )}
        <p className="text-[10px] text-on-surface-variant/50 mt-1">
          Advisory — the bundle manifest is authoritative and re-validated at
          install time.
        </p>
      </div>

      {/* Version history */}
      <div>
        <h4 className="text-xs font-semibold text-on-surface mb-1">Versions</h4>
        <ul className="space-y-1">
          {ext.versions.map((v) => (
            <li
              key={v.version}
              className="text-xs text-on-surface-variant flex items-center gap-2 flex-wrap"
            >
              <span className="font-mono text-on-surface">v{v.version}</span>
              {v.min_concord_version && (
                <span className="text-[10px] text-on-surface-variant/60">
                  needs Concord ≥ {v.min_concord_version}
                </span>
              )}
              {typeof v.size_bytes === "number" && (
                <span className="text-[10px] text-on-surface-variant/60">
                  {(v.size_bytes / 1024).toFixed(0)} KB
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
