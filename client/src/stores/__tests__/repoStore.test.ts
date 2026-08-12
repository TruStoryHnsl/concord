import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useRepoStore,
  validateRepoIndex,
  normalizeBaseUrl,
  probeRepoIndex,
  DEFAULT_EXTENSION_REPO_URL,
  type RepoIndex,
} from "../repoStore";

/* ── Fixtures ───────────────────────────────────────────────────── */

function validIndex(overrides: Partial<RepoIndex> = {}): RepoIndex {
  return {
    schema: "concord-repo/v1",
    repo_id: "community-repo",
    name: "Community Repo",
    maintainer: "someone",
    extensions: [
      {
        id: "com.example.draw",
        name: "Draw Tool",
        summary: "A drawing surface",
        author: "Alice",
        tags: ["art", "canvas"],
        latest: "2.0.0",
        versions: [
          {
            version: "2.0.0",
            bundle_url: "com.example.draw/2.0.0/bundle.zip",
            integrity: "sha384-AAAA",
          },
        ],
      },
      {
        id: "com.example.timer",
        name: "Pomodoro Timer",
        summary: "Focus timer",
        author: "Bob",
        tags: ["productivity"],
        latest: "1.1.0",
        versions: [
          {
            version: "1.1.0",
            bundle_url: "com.example.timer/1.1.0/bundle.zip",
            integrity: "sha384-BBBB",
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** Reset the store + localStorage to the seeded-default-only state. */
function resetStore() {
  localStorage.clear();
  useRepoStore.setState({
    repos: [
      {
        baseUrl: normalizeBaseUrl(DEFAULT_EXTENSION_REPO_URL),
        repoId: "concord-extensions",
        name: "Concord Extensions",
        pinned: true,
        verified: false,
        index: null,
        fetchedAt: null,
      },
    ],
  });
}

function mockFetchJson(map: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(map).find((k) => url.endsWith(k));
    if (key === undefined) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => map[key],
    } as Response;
  });
}

describe("validateRepoIndex", () => {
  it("accepts a well-formed concord-repo/v1 index", () => {
    expect(() => validateRepoIndex(validIndex())).not.toThrow();
  });

  it("rejects a wrong schema literal (unknown major → refuse)", () => {
    expect(() => validateRepoIndex(validIndex({ schema: "concord-repo/v2" }))).toThrow(
      /unsupported repo schema/,
    );
  });

  it("rejects a missing extensions array", () => {
    const bad = { schema: "concord-repo/v1", repo_id: "x", name: "X" };
    expect(() => validateRepoIndex(bad)).toThrow(/extensions/);
  });

  it("rejects non-object input", () => {
    expect(() => validateRepoIndex("nope")).toThrow();
    expect(() => validateRepoIndex(null)).toThrow();
  });
});

describe("normalizeBaseUrl", () => {
  it("strips a single trailing slash and trims", () => {
    expect(normalizeBaseUrl("  https://x.io/repo/  ")).toBe("https://x.io/repo");
    expect(normalizeBaseUrl("https://x.io/repo")).toBe("https://x.io/repo");
  });
});

describe("probeRepoIndex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the well-known path first", async () => {
    const idx = validIndex();
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": idx }),
    );
    const got = await probeRepoIndex("https://repo.example.io");
    expect(got.repo_id).toBe("community-repo");
  });

  it("falls back to index.json when well-known is absent", async () => {
    const idx = validIndex();
    vi.stubGlobal("fetch", mockFetchJson({ "/index.json": idx }));
    const got = await probeRepoIndex("https://repo.example.io");
    expect(got.repo_id).toBe("community-repo");
  });

  it("throws when neither path yields a valid index", async () => {
    vi.stubGlobal("fetch", mockFetchJson({}));
    await expect(probeRepoIndex("https://repo.example.io")).rejects.toThrow(
      /could not fetch a valid concord-repo\/v1 index/,
    );
  });

  it("rejects a 200 that fails schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": { schema: "wrong" } }),
    );
    await expect(probeRepoIndex("https://repo.example.io")).rejects.toThrow();
  });
});

describe("repoStore — pinning + add/remove", () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds the default repo pinned", () => {
    const { repos } = useRepoStore.getState();
    expect(repos).toHaveLength(1);
    expect(repos[0].pinned).toBe(true);
    expect(repos[0].repoId).toBe("concord-extensions");
  });

  it("refuses to remove the pinned default", () => {
    const { removeRepo, repos } = useRepoStore.getState();
    expect(() => removeRepo(repos[0].baseUrl)).toThrow(/cannot be removed/);
    expect(useRepoStore.getState().repos).toHaveLength(1);
  });

  it("adds a community repo after a successful probe", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": validIndex() }),
    );
    const repo = await useRepoStore.getState().addRepo("https://repo.example.io/");
    expect(repo.repoId).toBe("community-repo");
    expect(repo.pinned).toBe(false);
    expect(repo.verified).toBe(false); // no bundled key in test env
    expect(useRepoStore.getState().repos).toHaveLength(2);
  });

  it("rejects adding a duplicate base URL", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": validIndex() }),
    );
    await useRepoStore.getState().addRepo("https://repo.example.io");
    await expect(
      useRepoStore.getState().addRepo("https://repo.example.io/"),
    ).rejects.toThrow(/already added/);
  });

  it("propagates a probe failure on add (repo not persisted)", async () => {
    vi.stubGlobal("fetch", mockFetchJson({}));
    await expect(
      useRepoStore.getState().addRepo("https://bad.example.io"),
    ).rejects.toThrow();
    expect(useRepoStore.getState().repos).toHaveLength(1);
  });

  it("removes a non-pinned repo", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": validIndex() }),
    );
    const repo = await useRepoStore.getState().addRepo("https://repo.example.io");
    useRepoStore.getState().removeRepo(repo.baseUrl);
    expect(useRepoStore.getState().repos).toHaveLength(1);
    expect(useRepoStore.getState().repos[0].pinned).toBe(true);
  });
});

describe("repoStore — refresh + search", () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshRepo populates the index in place", async () => {
    const { repos } = useRepoStore.getState();
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": validIndex() }),
    );
    await useRepoStore.getState().refreshRepo(repos[0].baseUrl);
    const refreshed = useRepoStore.getState().repos[0];
    expect(refreshed.index).not.toBeNull();
    expect(refreshed.index!.extensions).toHaveLength(2);
    expect(refreshed.fetchedAt).toBeTypeOf("number");
    expect(refreshed.error).toBeUndefined();
  });

  it("records an error on refresh failure", async () => {
    const { repos } = useRepoStore.getState();
    vi.stubGlobal("fetch", mockFetchJson({}));
    await expect(
      useRepoStore.getState().refreshRepo(repos[0].baseUrl),
    ).rejects.toThrow();
    expect(useRepoStore.getState().repos[0].error).toBeTruthy();
  });

  it("searches across all repos by name/summary/tag/author/id", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({ "/.well-known/concord-repo.json": validIndex() }),
    );
    await useRepoStore.getState().addRepo("https://repo.example.io");

    const byName = useRepoStore.getState().search("pomodoro");
    expect(byName).toHaveLength(1);
    expect(byName[0].extension.id).toBe("com.example.timer");

    const byTag = useRepoStore.getState().search("canvas");
    expect(byTag.map((r) => r.extension.id)).toContain("com.example.draw");

    const byAuthor = useRepoStore.getState().search("alice");
    expect(byAuthor[0].extension.id).toBe("com.example.draw");

    const empty = useRepoStore.getState().search("");
    expect(empty).toHaveLength(2); // empty query lists everything
  });

  it("search ignores repos with no fetched index", () => {
    // Default repo seeded with index:null → search returns nothing.
    expect(useRepoStore.getState().search("anything")).toHaveLength(0);
  });
});
