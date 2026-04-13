import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMatrixSourceDraft,
  clearPendingSourceSso,
  clearPendingSourceSsoQueryParams,
  hasPendingSourceSsoCallback,
  readPendingSourceSso,
  upsertMatrixSourceRecord,
  writePendingSourceSso,
} from "../matrixSourceAuth";
import type { ConcordSource } from "../../../stores/sources";

describe("matrixSourceAuth helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("builds a delegated matrix source draft from discovery", () => {
    const draft = buildMatrixSourceDraft(
      "chat.mozilla.org",
      {
        host: "chat.mozilla.org",
        homeserver_url: "https://mozilla.modular.im",
        server_name: "mozilla.org",
        api_base: "https://chat.mozilla.org/api",
      },
      ["sso", "token"],
    );

    expect(draft).toEqual({
      host: "chat.mozilla.org",
      instanceName: "mozilla.org",
      apiBase: "https://chat.mozilla.org/api",
      homeserverUrl: "https://mozilla.modular.im",
      serverName: "mozilla.org",
      delegatedFrom: "chat.mozilla.org",
      authFlows: ["sso", "token"],
    });
  });

  it("upserts an existing source record instead of duplicating it", () => {
    const existing: ConcordSource = {
      id: "src_mozilla",
      host: "chat.mozilla.org",
      instanceName: "Mozilla",
      inviteToken: "",
      apiBase: "https://chat.mozilla.org/api",
      homeserverUrl: "https://mozilla.modular.im",
      serverName: "mozilla.org",
      delegatedFrom: "chat.mozilla.org",
      status: "disconnected",
      enabled: true,
      addedAt: new Date().toISOString(),
      platform: "matrix",
    };
    const updateSource = vi.fn();
    const addSource = vi.fn();

    const id = upsertMatrixSourceRecord({
      sources: [existing],
      addSource,
      updateSource,
      draft: {
        host: "chat.mozilla.org",
        instanceName: "mozilla.org",
        apiBase: "https://chat.mozilla.org/api",
        homeserverUrl: "https://mozilla.modular.im",
        serverName: "mozilla.org",
        delegatedFrom: "chat.mozilla.org",
        authFlows: ["sso", "token"],
      },
      session: {
        accessToken: "abc",
        userId: "@user:mozilla.org",
        deviceId: "DEVICE",
      },
    });

    expect(id).toBe("src_mozilla");
    expect(addSource).not.toHaveBeenCalled();
    expect(updateSource).toHaveBeenCalledWith(
      "src_mozilla",
      expect.objectContaining({
        accessToken: "abc",
        userId: "@user:mozilla.org",
        deviceId: "DEVICE",
        serverName: "mozilla.org",
        status: "connected",
      }),
    );
  });

  it("stores and clears pending source sso callbacks", () => {
    writePendingSourceSso({
      sourceId: "src_mozilla",
      homeserverUrl: "https://mozilla.modular.im",
    });
    window.history.replaceState(
      {},
      "",
      "/?loginToken=token123&source_sso=1",
    );

    expect(readPendingSourceSso()).toEqual({
      sourceId: "src_mozilla",
      homeserverUrl: "https://mozilla.modular.im",
    });
    expect(hasPendingSourceSsoCallback()).toBe(true);

    clearPendingSourceSsoQueryParams();
    expect(window.location.search).toBe("");

    clearPendingSourceSso();
    expect(readPendingSourceSso()).toBeNull();
  });
});
