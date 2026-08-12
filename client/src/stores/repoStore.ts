/**
 * S3 — Community extension repository store (`concord-repo/v1`).
 *
 * Sibling of `extension.ts`. Where `extension.ts` tracks what is *installed*
 * on the connected instance, this store tracks the user's list of *repos*
 * (discovery indexes) they can browse + install from. It is a per-user
 * **client preference** persisted to localStorage — managing the repo list
 * is NOT admin-gated (only the install/uninstall actions are, server-side).
 *
 * A repo is identified by its base URL `B`. Probe order on add/refresh:
 *
 *   1. GET `B/.well-known/concord-repo.json`   (REQUIRED, primary)
 *   2. GET `B/index.json`                      (OPTIONAL fallback)
 *
 * The fetched JSON must have `schema === "concord-repo/v1"` (unknown major
 * → refuse). The default `concord-extensions` repo is seeded pinned and
 * undeletable; a bundled public key gives it a TOFU-free "verified" badge.
 *
 * Signature verification (S5) is best-effort and NEVER blocks: a repo whose
 * `signing` block verifies against the **bundled default key** is marked
 * `verified`; everything else is `unverified` (community — warn on add).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { verifyIndexSignature } from "../lib/repoSignature";

/* ── Compile-time defaults ──────────────────────────────────────── */

/**
 * The canonical public `concord-extensions` repository base URL.
 *
 * Resolution order:
 *   1. `VITE_EXTENSION_REPO_URL` build-env override (forks rebrand the
 *      default without touching source) — see spec §7 open-q 3.
 *   2. The public GitHub Pages URL for the reference repo.
 *
 * This is a PUBLIC static-host URL — it is NOT a secret. Trailing slash is
 * normalized away by `normalizeBaseUrl` so all comparisons are stable.
 */
const ENV_REPO_URL =
  (import.meta as unknown as { env?: { VITE_EXTENSION_REPO_URL?: string } }).env
    ?.VITE_EXTENSION_REPO_URL;

export const DEFAULT_EXTENSION_REPO_URL =
  ENV_REPO_URL && ENV_REPO_URL.trim()
    ? ENV_REPO_URL.trim()
    : "https://trustoryhnsl.github.io/concord-extensions";

/**
 * Bundled Ed25519 public key for the default repo (S5 §7 open-q 4: ship the
 * `concord-extensions` pubkey so the default is verified TOFU-free). Format
 * `ed25519:BASE64`. Sourced from build-env so the real key is injected at
 * release time; an empty value simply means the default shows "unverified"
 * until a key is wired (signing never gates install).
 */
export const DEFAULT_EXTENSION_REPO_PUBKEY =
  (import.meta as unknown as { env?: { VITE_EXTENSION_REPO_PUBKEY?: string } })
    .env?.VITE_EXTENSION_REPO_PUBKEY?.trim() ?? "";

const STORAGE_KEY = "concord:extension-repos:v1";

/* ── Types ──────────────────────────────────────────────────────── */

/** One version entry inside an index extension (newest-first). */
export interface RepoExtensionVersion {
  version: string;
  bundle_url: string;
  integrity: string;
  min_concord_version?: string;
  manifest_url?: string;
  permissions?: string[];
  size_bytes?: number;
  released_at?: string;
  changelog?: string;
}

/** One extension as advertised by a repo index. */
export interface RepoExtension {
  id: string;
  name: string;
  icon?: string;
  summary?: string;
  author?: string;
  tags?: string[];
  latest: string;
  versions: RepoExtensionVersion[];
}

/** The parsed `concord-repo/v1` index document. */
export interface RepoIndex {
  schema: string;
  repo_id: string;
  name: string;
  description?: string;
  homepage?: string;
  icon?: string;
  maintainer?: string;
  updated_at?: string;
  signing?: {
    public_key: string;
    index_sig?: string;
  };
  extensions: RepoExtension[];
}

export interface ExtensionRepo {
  /** Normalized base URL `B` (no trailing slash). Primary key. */
  baseUrl: string;
  /** `repo_id` from the index (stable slug). */
  repoId: string;
  /** Human-facing name from the index. */
  name: string;
  /** Pinned repos cannot be removed (the bundled default). */
  pinned: boolean;
  /** Ed25519 signature verified against the bundled/pinned key. */
  verified: boolean;
  /** The parsed index, or null if a fetch has never succeeded. */
  index: RepoIndex | null;
  /** Epoch ms of the last successful fetch, or null. */
  fetchedAt: number | null;
  /** Last error message from a failed probe/refresh, if any. */
  error?: string;
}

/** A single search hit across all repos' indexes. */
export interface RepoSearchResult {
  baseUrl: string;
  repoId: string;
  repoName: string;
  verified: boolean;
  extension: RepoExtension;
}

interface RepoState {
  repos: ExtensionRepo[];
  /** Probe + validate + persist a new repo. Throws on probe/validate fail. */
  addRepo: (url: string) => Promise<ExtensionRepo>;
  /** Remove a repo by base URL. Refuses (throws) if the repo is pinned. */
  removeRepo: (baseUrl: string) => void;
  /** Re-probe an existing repo and refresh its index in place. */
  refreshRepo: (baseUrl: string) => Promise<void>;
  /** Client-side fuzzy search across every repo's index. */
  search: (q: string) => RepoSearchResult[];
}

/* ── URL + probe helpers ────────────────────────────────────────── */

/** Strip a single trailing slash so base-URL comparisons are stable. */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Validate the structural shape + `schema` literal of a fetched index.
 * Throws a descriptive Error on any failure. Returns the typed index.
 *
 * Deliberately checks the load-bearing invariants only (schema literal,
 * required top-level fields, extensions array) — the server-side JSON
 * Schema (`concord-repo.v1.schema.json`) is the exhaustive contract; this
 * is the runtime guard that protects the store from garbage.
 */
export function validateRepoIndex(raw: unknown): RepoIndex {
  if (!raw || typeof raw !== "object") {
    throw new Error("repo index is not a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schema !== "concord-repo/v1") {
    throw new Error(
      `unsupported repo schema: expected "concord-repo/v1", got ${JSON.stringify(
        obj.schema,
      )}`,
    );
  }
  if (typeof obj.repo_id !== "string" || !obj.repo_id) {
    throw new Error("repo index missing repo_id");
  }
  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error("repo index missing name");
  }
  if (!Array.isArray(obj.extensions)) {
    throw new Error("repo index missing extensions array");
  }
  return obj as unknown as RepoIndex;
}

/**
 * Fetch + parse a repo index from a base URL, trying the well-known path
 * first and falling back to `index.json`. Returns the validated index.
 * Throws if neither path yields a valid `concord-repo/v1` document.
 */
export async function probeRepoIndex(baseUrl: string): Promise<RepoIndex> {
  const base = normalizeBaseUrl(baseUrl);
  const candidates = [`${base}/.well-known/concord-repo.json`, `${base}/index.json`];

  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        lastErr = new Error(`${url} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      // A 200 that fails schema validation is a hard error for THAT
      // candidate, but we still let the loop try the fallback path —
      // a misconfigured well-known shouldn't mask a valid index.json.
      try {
        return validateRepoIndex(raw);
      } catch (validationErr) {
        lastErr =
          validationErr instanceof Error
            ? validationErr
            : new Error(String(validationErr));
        continue;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `could not fetch a valid concord-repo/v1 index from ${base} (${
      lastErr?.message ?? "unknown error"
    })`,
  );
}

/**
 * Decide a repo's trust badge. "verified" iff the index ships a `signing`
 * block whose detached signature verifies against the BUNDLED DEFAULT key.
 * Community repos that sign with their own key are still "unverified" —
 * trust here means "signed by the key we ship", which is provenance, not a
 * privilege boundary (the sandbox is identical for all). Never throws.
 */
export async function computeVerified(index: RepoIndex): Promise<boolean> {
  const sig = index.signing?.index_sig;
  if (!sig || !DEFAULT_EXTENSION_REPO_PUBKEY) return false;
  return verifyIndexSignature(index, DEFAULT_EXTENSION_REPO_PUBKEY, sig);
}

/* ── Default repo seed ──────────────────────────────────────────── */

function seedDefaultRepo(): ExtensionRepo {
  return {
    baseUrl: normalizeBaseUrl(DEFAULT_EXTENSION_REPO_URL),
    repoId: "concord-extensions",
    name: "Concord Extensions",
    pinned: true,
    verified: false, // upgraded to true after the first verified refresh
    index: null,
    fetchedAt: null,
  };
}

/* ── Store ──────────────────────────────────────────────────────── */

export const useRepoStore = create<RepoState>()(
  persist(
    (set, get) => ({
      repos: [seedDefaultRepo()],

      addRepo: async (url) => {
        const baseUrl = normalizeBaseUrl(url);
        if (!baseUrl) throw new Error("empty repo URL");

        // Reject duplicates up front (case-sensitive on the URL — host
        // case-folding is out of scope; the user pasted a specific URL).
        if (get().repos.some((r) => r.baseUrl === baseUrl)) {
          throw new Error("repo already added");
        }

        const index = await probeRepoIndex(baseUrl);
        const verified = await computeVerified(index);

        const repo: ExtensionRepo = {
          baseUrl,
          repoId: index.repo_id,
          name: index.name,
          pinned: false,
          verified,
          index,
          fetchedAt: Date.now(),
        };
        set((s) => ({ repos: [...s.repos, repo] }));
        return repo;
      },

      removeRepo: (baseUrl) => {
        const target = normalizeBaseUrl(baseUrl);
        const repo = get().repos.find((r) => r.baseUrl === target);
        if (!repo) return;
        if (repo.pinned) {
          throw new Error("the default repository cannot be removed");
        }
        set((s) => ({ repos: s.repos.filter((r) => r.baseUrl !== target) }));
      },

      refreshRepo: async (baseUrl) => {
        const target = normalizeBaseUrl(baseUrl);
        if (!get().repos.some((r) => r.baseUrl === target)) {
          throw new Error("repo not found");
        }
        try {
          const index = await probeRepoIndex(target);
          const verified = await computeVerified(index);
          set((s) => ({
            repos: s.repos.map((r) =>
              r.baseUrl === target
                ? {
                    ...r,
                    repoId: index.repo_id,
                    name: index.name,
                    index,
                    verified,
                    fetchedAt: Date.now(),
                    error: undefined,
                  }
                : r,
            ),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((s) => ({
            repos: s.repos.map((r) =>
              r.baseUrl === target ? { ...r, error: message } : r,
            ),
          }));
          throw err;
        }
      },

      search: (q) => {
        const needle = q.trim().toLowerCase();
        const out: RepoSearchResult[] = [];
        for (const repo of get().repos) {
          if (!repo.index) continue;
          for (const ext of repo.index.extensions) {
            // Empty query → match everything (acts as a full listing).
            const haystack = [
              ext.name,
              ext.summary ?? "",
              ext.author ?? "",
              (ext.tags ?? []).join(" "),
              ext.id,
            ]
              .join(" ")
              .toLowerCase();
            if (needle === "" || haystack.includes(needle)) {
              out.push({
                baseUrl: repo.baseUrl,
                repoId: repo.repoId,
                repoName: repo.name,
                verified: repo.verified,
                extension: ext,
              });
            }
          }
        }
        return out;
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Persist only the repo LIST (urls + pin flags). Indexes are
      // re-fetched on demand so a stale cached index never ships an
      // outdated bundle URL. After rehydration we re-seed the pinned
      // default if a prior version dropped it.
      partialize: (s) => ({
        repos: s.repos.map((r) => ({
          baseUrl: r.baseUrl,
          repoId: r.repoId,
          name: r.name,
          pinned: r.pinned,
          // Indexes are intentionally NOT persisted; null on rehydrate.
          verified: false,
          index: null,
          fetchedAt: null,
        })),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const hasDefault = state.repos.some((r) => r.pinned);
        if (!hasDefault) {
          state.repos = [seedDefaultRepo(), ...state.repos];
        }
      },
    },
  ),
);
