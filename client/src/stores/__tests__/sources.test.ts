import { beforeEach, describe, expect, it } from "vitest";
import {
  getSourceMatrixDomains,
  sourceMatchesMatrixDomain,
  useSourcesStore,
} from "../sources";

describe("sources store", () => {
  beforeEach(() => {
    useSourcesStore.setState({
      boundUserId: "@alice:concorrd.com",
      sources: [
        {
          id: "src_matrix",
          host: "chat.mozilla.org",
          instanceName: "Mozilla",
          inviteToken: "",
          apiBase: "https://chat.mozilla.org/api",
          homeserverUrl: "https://mozilla.modular.im",
          serverName: "mozilla.org",
          delegatedFrom: "chat.mozilla.org",
          status: "connected",
          enabled: true,
          addedAt: new Date().toISOString(),
          platform: "matrix",
          ownerUserId: "@alice:concorrd.com",
        },
        {
          id: "src_concord",
          host: "concorrd.com",
          instanceName: "Concorrd",
          inviteToken: "",
          apiBase: "https://concorrd.com/api",
          homeserverUrl: "https://concorrd.com",
          status: "connected",
          enabled: true,
          addedAt: new Date().toISOString(),
          platform: "concord",
          ownerUserId: null,
        },
      ],
    });
  });

  it("reorders source tiles in persisted store order", () => {
    useSourcesStore.getState().reorderSources("src_concord", "src_matrix");
    expect(useSourcesStore.getState().sources.map((source) => source.id)).toEqual([
      "src_concord",
      "src_matrix",
    ]);
  });

  it("can replace the full source order explicitly", () => {
    useSourcesStore.getState().setSourceOrder(["src_concord", "src_matrix"]);
    expect(useSourcesStore.getState().sources.map((source) => source.id)).toEqual([
      "src_concord",
      "src_matrix",
    ]);
  });

  it("matches delegated Matrix domains for discovery-driven sources", () => {
    const source = useSourcesStore.getState().sources[0];
    expect(getSourceMatrixDomains(source)).toEqual([
      "chat.mozilla.org",
      "mozilla.org",
      "mozilla.modular.im",
    ]);
    expect(sourceMatchesMatrixDomain(source, "mozilla.org")).toBe(true);
    expect(sourceMatchesMatrixDomain(source, "mozilla.modular.im")).toBe(true);
    expect(sourceMatchesMatrixDomain(source, "matrix.org")).toBe(false);
  });

  it("drops user-owned sources when a different Concord user binds to the store", () => {
    useSourcesStore.getState().bindToUser("@bob:concorrd.com");
    expect(useSourcesStore.getState().sources.map((source) => source.id)).toEqual([
      "src_concord",
    ]);
  });

  it("preserves instance-global primary sources on logout", () => {
    useSourcesStore.getState().bindToUser(null);
    expect(useSourcesStore.getState().sources.map((source) => source.id)).toEqual([
      "src_concord",
    ]);
  });
});
