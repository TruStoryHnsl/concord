import { useEffect, useState, useCallback, type FormEvent } from "react";
import GlassPanel from "@/components/ui/GlassPanel";
import Skeleton from "@/components/ui/Skeleton";
import ForumPostCard from "./ForumPostCard";
import { useForumStore } from "@/stores/forum";
import { getPeerTrust } from "@/api/tauri";
import type { TrustLevel } from "@/api/tauri";

type ForumTab = "local" | "global";

function ForumPage() {
  const [activeTab, setActiveTab] = useState<ForumTab>("local");
  const [composeContent, setComposeContent] = useState("");
  const [posting, setPosting] = useState(false);

  const localPosts = useForumStore((s) => s.localPosts);
  const globalPosts = useForumStore((s) => s.globalPosts);
  const localRange = useForumStore((s) => s.localRange);
  const loading = useForumStore((s) => s.loading);
  const loadPosts = useForumStore((s) => s.loadPosts);
  const postToLocal = useForumStore((s) => s.postToLocal);
  const postToGlobal = useForumStore((s) => s.postToGlobal);
  const setLocalRange = useForumStore((s) => s.setLocalRange);

  useEffect(() => {
    void loadPosts(activeTab);
  }, [activeTab, loadPosts]);

  const posts = activeTab === "local" ? localPosts : globalPosts;
  const [authorTrust, setAuthorTrust] = useState<Record<string, TrustLevel>>({});

  // Fetch trust for unique post authors
  useEffect(() => {
    const authorIds = [...new Set(posts.map((p) => p.authorId))];
    const missing = authorIds.filter((id) => !(id in authorTrust));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) =>
        getPeerTrust(id).then((t) => [id, t.badge] as const).catch(() => null),
      ),
    ).then((results) => {
      const updates: Record<string, TrustLevel> = {};
      for (const r of results) {
        if (r) updates[r[0]] = r[1];
      }
      if (Object.keys(updates).length > 0) {
        setAuthorTrust((prev) => ({ ...prev, ...updates }));
      }
    });
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePost = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = composeContent.trim();
      if (!trimmed || posting) return;

      setPosting(true);
      try {
        if (activeTab === "local") {
          await postToLocal(trimmed);
        } else {
          await postToGlobal(trimmed);
        }
        setComposeContent("");
      } finally {
        setPosting(false);
      }
    },
    [composeContent, posting, activeTab, postToLocal, postToGlobal],
  );

  return (
    <div className="mesh-background min-h-full p-4 md:p-6">
      <div className="relative z-10 max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="font-headline font-bold text-2xl text-on-surface">
            Forums
          </h1>
          <p className="text-sm text-on-surface-variant font-body">
            Posts from the mesh network, near and far.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container-high w-fit">
          <button
            onClick={() => setActiveTab("local")}
            className={`px-4 py-1.5 rounded-lg text-sm font-label font-medium transition-all ${
              activeTab === "local"
                ? "bg-secondary/20 text-secondary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-sm align-middle mr-1">
              sensors
            </span>
            Local
          </button>
          <button
            onClick={() => setActiveTab("global")}
            className={`px-4 py-1.5 rounded-lg text-sm font-label font-medium transition-all ${
              activeTab === "global"
                ? "bg-primary/20 text-primary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-sm align-middle mr-1">
              public
            </span>
            Global
          </button>
        </div>

        {/* Local range slider */}
        {activeTab === "local" && (
          <div className="flex items-center gap-3 px-1">
            <span className="text-[11px] text-on-surface-variant font-label whitespace-nowrap">
              Show posts within
            </span>
            <input
              type="range"
              min={1}
              max={10}
              value={localRange}
              onChange={(e) => setLocalRange(Number(e.target.value))}
              className="flex-1 h-1 bg-surface-container-high rounded-full appearance-none cursor-pointer accent-secondary"
            />
            <span className="text-sm font-label font-semibold text-secondary min-w-[4ch] text-right">
              {localRange} hop{localRange !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Compose area */}
        <GlassPanel className="rounded-xl p-4">
          <form onSubmit={(e) => void handlePost(e)}>
            <textarea
              value={composeContent}
              onChange={(e) => setComposeContent(e.target.value)}
              placeholder={`Post to ${activeTab === "local" ? "nearby nodes" : "the entire mesh"}...`}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm border-none resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-on-surface-variant font-body">
                {activeTab === "local"
                  ? `Visible within ${localRange} hops`
                  : "Visible to all mesh nodes"}
              </span>
              <button
                type="submit"
                disabled={!composeContent.trim() || posting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl primary-glow text-on-primary font-label font-medium text-sm hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-base">
                  send
                </span>
                Post
              </button>
            </div>
          </form>
        </GlassPanel>

        {/* Posts */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <GlassPanel key={i} className="rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-9 h-9" circle />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </GlassPanel>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <GlassPanel className="rounded-xl p-8 flex flex-col items-center text-center space-y-3">
            <span className="material-symbols-outlined text-4xl text-primary/40">
              forum
            </span>
            <p className="font-headline font-semibold text-on-surface">
              No posts yet
            </p>
            <p className="text-sm text-on-surface-variant font-body max-w-xs">
              {activeTab === "local"
                ? "Be the first to post in your local mesh area."
                : "No global posts available. Start the conversation!"}
            </p>
          </GlassPanel>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <ForumPostCard key={post.id} post={post} trustLevel={authorTrust[post.authorId]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ForumPage;
