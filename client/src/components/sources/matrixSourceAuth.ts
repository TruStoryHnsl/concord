import type { MatrixLoginFlowKind } from "../../api/matrix";
import type { HomeserverConfig } from "../../api/wellKnown";
import type { ConcordSource, SourcesState } from "../../stores/sources";

export interface MatrixSourceDraft {
  host: string;
  instanceName: string;
  apiBase: string;
  homeserverUrl: string;
  serverName?: string;
  delegatedFrom?: string;
  authFlows: MatrixLoginFlowKind[];
}

export interface PendingSourceSso {
  sourceId: string;
  homeserverUrl: string;
}

const SOURCE_SSO_STORAGE_KEY = "concord_pending_source_sso";

export function buildMatrixSourceDraft(
  typedHost: string,
  config: HomeserverConfig,
  authFlows: MatrixLoginFlowKind[],
): MatrixSourceDraft {
  const host = typedHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  let delegatedFrom: string | undefined;
  try {
    const homeserverHost = new URL(config.homeserver_url).host.toLowerCase();
    if (homeserverHost !== host) delegatedFrom = host;
  } catch {
    delegatedFrom = undefined;
  }

  return {
    host,
    instanceName:
      config.instance_name ??
      config.server_name ??
      config.host ??
      host,
    apiBase: config.api_base,
    homeserverUrl: config.homeserver_url,
    serverName: config.server_name,
    delegatedFrom,
    authFlows,
  };
}

function matchesExistingSource(
  source: ConcordSource,
  draft: MatrixSourceDraft,
): boolean {
  const sourceTokens = new Set(
    [
      source.host,
      source.serverName,
      source.delegatedFrom,
      source.homeserverUrl,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase()),
  );
  const draftTokens = [
    draft.host,
    draft.serverName,
    draft.delegatedFrom,
    draft.homeserverUrl,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return (
    (source.platform ?? "concord") === "matrix" &&
    draftTokens.some((token) => sourceTokens.has(token))
  );
}

export function upsertMatrixSourceRecord(args: {
  sources: ConcordSource[];
  addSource: SourcesState["addSource"];
  updateSource: SourcesState["updateSource"];
  draft: MatrixSourceDraft;
  session?: { accessToken: string; userId: string; deviceId: string };
  authError?: string;
}): string {
  const { sources, addSource, updateSource, draft, session, authError } = args;
  const existing = sources.find((source) => matchesExistingSource(source, draft));
  const patch = {
    host: draft.host,
    instanceName: draft.instanceName,
    inviteToken: "",
    apiBase: draft.apiBase,
    homeserverUrl: draft.homeserverUrl,
    serverName: draft.serverName,
    delegatedFrom: draft.delegatedFrom,
    authFlows: draft.authFlows,
    accessToken: session?.accessToken,
    userId: session?.userId,
    deviceId: session?.deviceId,
    authError,
    status: (session ? "connected" : "disconnected") as ConcordSource["status"],
    enabled: existing?.enabled ?? true,
    platform: "matrix" as const,
  };

  if (existing) {
    updateSource(existing.id, patch);
    return existing.id;
  }

  return addSource(patch);
}

export function readPendingSourceSso(): PendingSourceSso | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SOURCE_SSO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSourceSso;
    if (!parsed?.sourceId || !parsed?.homeserverUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingSourceSso(pending: PendingSourceSso): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SOURCE_SSO_STORAGE_KEY, JSON.stringify(pending));
}

export function clearPendingSourceSso(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SOURCE_SSO_STORAGE_KEY);
}

export function hasPendingSourceSsoCallback(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("loginToken") && readPendingSourceSso());
}

export function clearPendingSourceSsoQueryParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("loginToken");
  url.searchParams.delete("source_sso");
  window.history.replaceState({}, "", url.toString());
}
