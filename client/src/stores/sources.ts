/**
 * Sources store — manages connections to Concord instances (INS-020).
 *
 * Native apps (iOS, desktop Tauri) connect to MULTIPLE Concord instances
 * simultaneously. Each connection is a "source" established via an invite
 * token. The server sidebar aggregates servers from all connected sources.
 *
 * Web clients (docker-served) skip this layer entirely — the single
 * instance IS the source, and the browser user is already "inside" it.
 *
 * Persistence: localStorage via Zustand's `persist` middleware, same
 * pattern as `serverConfig.ts`. Tokens are stored locally — future
 * enhancement could use Tauri Stronghold for encrypted storage.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useServerConfigStore } from "./serverConfig";
import { useFederatedInstanceStore } from "./federatedInstances";
import { getServerUrl } from "../api/serverUrl";

export interface ConcordSource {
  /** Unique ID for this source connection. */
  id: string;
  /** The hostname of the Concord instance (e.g., "concorrd.com"). */
  host: string;
  /** Human-readable instance name (from .well-known/concord/client). */
  instanceName?: string;
  /** The invite token used to establish this connection. */
  inviteToken: string;
  /** Matrix access token for authenticated API calls to this instance. */
  accessToken?: string;
  /** Matrix user ID on this instance (e.g., "@corr:concorrd.com"). */
  userId?: string;
  /** Concord API base URL (from well-known discovery). */
  apiBase: string;
  /** Matrix homeserver URL (from well-known discovery). */
  homeserverUrl: string;
  /** Connection status. */
  status: "connecting" | "connected" | "disconnected" | "error";
  /** Whether this source's servers are visible in the server column. */
  enabled: boolean;
  /** Error message if status is "error". */
  error?: string;
  /** When this source was added (ISO timestamp). */
  addedAt: string;
}

export interface SourcesState {
  sources: ConcordSource[];
  /** Add a new source. Returns the generated source ID. */
  addSource: (source: Omit<ConcordSource, "id" | "addedAt">) => string;
  /** Update an existing source by ID. */
  updateSource: (id: string, patch: Partial<ConcordSource>) => void;
  /** Remove a source by ID. */
  removeSource: (id: string) => void;
  /** Get a source by ID. */
  getSource: (id: string) => ConcordSource | undefined;
  /** Get all connected + enabled sources. */
  connectedSources: () => ConcordSource[];
  /** Toggle a source's visibility in the server column. */
  toggleSource: (id: string) => void;
  /** Sync Discord bridge source state from Matrix room scan. */
  syncDiscordBridge: (bridgeRunning: boolean) => void;
  /** One-time migration from active session (native first launch). */
  migrateFromSession: () => void;
}

const STORAGE_KEY = "concord_sources";

function generateSourceId(): string {
  return `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useSourcesStore = create<SourcesState>()(
  persist(
    (set, get) => ({
      sources: [],

      addSource: (source) => {
        const id = generateSourceId();
        const full: ConcordSource = {
          ...source,
          id,
          addedAt: new Date().toISOString(),
        };
        set((state) => ({ sources: [...state.sources, full] }));
        return id;
      },

      updateSource: (id, patch) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, ...patch } : s,
          ),
        }));
      },

      removeSource: (id) => {
        set((state) => ({
          sources: state.sources.filter((s) => s.id !== id),
        }));
      },

      getSource: (id) => get().sources.find((s) => s.id === id),

      connectedSources: () =>
        get().sources.filter((s) => s.status === "connected" && s.enabled),

      toggleSource: (id) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, enabled: !s.enabled } : s,
          ),
        }));
      },

      syncDiscordBridge: (_bridgeRunning) => {
        // Stub — Discord bridge source management is handled by
        // the migration flow. This satisfies calls from useMatrix.ts.
      },

      /**
       * One-time migration: populate sources from the active session.
       * Called on native app startup when the sources store is empty
       * but an existing serverConfig + federated instances exist.
       * Creates source entries for the primary instance and each
       * federated server so the Sources panel reflects reality.
       */
      migrateFromSession: () => {
        if (get().sources.length > 0) return; // already populated

        const config = useServerConfigStore.getState().config;
        const instances = useFederatedInstanceStore.getState().instances;

        // Primary instance resolution:
        //
        // Preferred path — `serverConfig.config` (post-INS-027). The
        // server picker flow populates this from a live
        // `.well-known/concord/client` discovery, so it carries the
        // full instance metadata (display name, LiveKit URL, etc.)
        // alongside the API base.
        //
        // Legacy fallback — when `config` is null (noon-base native
        // builds that never shipped the picker, and pre-INS-027 Tauri
        // installs that configured their server via settings.json
        // before the picker existed), synthesize a minimal primary
        // source from the legacy `_serverUrl` that `initServerUrl()`
        // populated from the Tauri plugin-store on module load.
        // Without this fallback, such builds strand the user on the
        // Sources empty state after a successful login because the
        // source row is what the sidebar keys off of, and nothing
        // else in the boot path would create one. The synthesized
        // source has no `instanceName` yet — LoginForm will fill
        // that in via `getInstanceInfo()` if a later UX iteration
        // wires a post-login update, but for the minimum viable
        // state-of-three-platforms-working it is enough to have
        // `host`, `apiBase`, and `homeserverUrl` populated so the
        // sidebar can render servers + channels.
        if (config) {
          const id = generateSourceId();
          const primary: ConcordSource = {
            id,
            host: config.host,
            instanceName: config.instance_name,
            inviteToken: "",
            accessToken: undefined,
            apiBase: config.api_base,
            homeserverUrl: config.homeserver_url,
            status: "connected",
            enabled: true,
            addedAt: new Date().toISOString(),
          };
          set((state) => ({ sources: [...state.sources, primary] }));
        } else {
          const legacyUrl = getServerUrl();
          if (legacyUrl) {
            let host = legacyUrl;
            try {
              host = new URL(legacyUrl).hostname;
            } catch {
              // URL parse failed — fall back to the raw string rather
              // than crashing the migration path. A malformed server
              // URL here is a deep configuration bug elsewhere; this
              // `try`/`catch` just prevents a thrown exception from
              // stranding the entire startup sequence.
            }
            const id = generateSourceId();
            const primary: ConcordSource = {
              id,
              host,
              instanceName: undefined,
              inviteToken: "",
              accessToken: undefined,
              apiBase: `${legacyUrl}/api`,
              homeserverUrl: legacyUrl,
              status: "connected",
              enabled: true,
              addedAt: new Date().toISOString(),
            };
            set((state) => ({ sources: [...state.sources, primary] }));
          }
        }

        // Federated instances
        for (const [hostname, inst] of Object.entries(instances)) {
          // Skip the primary instance if it's also in the federated catalog
          if (config && hostname === config.host) continue;
          const id = generateSourceId();
          const federated: ConcordSource = {
            id,
            host: hostname,
            instanceName: inst.displayName || hostname,
            inviteToken: "",
            apiBase: `https://${hostname}/api`,
            homeserverUrl: `https://${hostname}`,
            status: inst.status === "live" ? "connected" : "disconnected",
            enabled: true,
            addedAt: new Date().toISOString(),
          };
          set((state) => ({ sources: [...state.sources, federated] }));
        }
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      partialize: (state) => ({ sources: state.sources }),
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { sources?: ConcordSource[] };
        if (version === 0 && state.sources) {
          // v0 → v1: ensure every source has `enabled` defaulting to true.
          state.sources = state.sources.map((s) => ({
            ...s,
            enabled: s.enabled ?? true,
          }));
        }
        return state as SourcesState;
      },
    },
  ),
);
