import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { getPerspectiveView, getForumPosts, postToLocalForum } from "@/api/tauri";
import type { PerspectiveNode, PerspectiveViewPayload, PlaceFrontend, NodeRelation, ForumPost, TrustLevel } from "@/api/tauri";
import { shortenPeerId, formatRelativeTime } from "@/utils/format";
import GlassPanel from "@/components/ui/GlassPanel";
import TrustBadge from "@/components/ui/TrustBadge";
import Skeleton from "@/components/ui/Skeleton";

/** Derive a TrustLevel badge from a 0-1 trust rating. */
function trustLevelFromRating(rating: number | null): TrustLevel {
  if (rating === null) return "unverified";
  if (rating < 0) return "flagged";
  if (rating < 0.2) return "unverified";
  if (rating < 0.4) return "recognized";
  if (rating < 0.6) return "established";
  if (rating < 0.8) return "trusted";
  return "backbone";
}

/** Format engagement score (-10 to +10) as a label. */
function engagementLabel(score: number | null): { text: string; color: string } | null {
  if (score === null) return null;
  if (score <= -5) return { text: "Reader", color: "text-blue-400" };
  if (score <= -2) return { text: "Listener", color: "text-blue-300" };
  if (score <= 2) return { text: "Balanced", color: "text-on-surface-variant" };
  if (score <= 5) return { text: "Active", color: "text-secondary" };
  return { text: "Leader", color: "text-primary" };
}

/* ── Visual Helpers ────────────────────────────────────────────── */

const RELATION_COLORS: Record<NodeRelation, { dot: string; line: string; glow: string }> = {
  self:        { dot: "bg-primary",         line: "#a4a5ff", glow: "shadow-[0_0_16px_rgba(164,165,255,0.6)]" },
  friend:      { dot: "bg-secondary",       line: "#afefdd", glow: "shadow-[0_0_14px_rgba(175,239,221,0.5)]" },
  local:       { dot: "bg-secondary",       line: "#afefdd", glow: "shadow-[0_0_12px_rgba(175,239,221,0.4)]" },
  tunnel:      { dot: "bg-primary-fixed",   line: "#a4a5ff", glow: "shadow-[0_0_10px_rgba(148,150,255,0.4)]" },
  mesh:        { dot: "bg-on-surface-variant", line: "#757780", glow: "shadow-[0_0_6px_rgba(117,119,128,0.3)]" },
  speculative: { dot: "bg-outline-variant", line: "#46484b", glow: "" },
  center:      { dot: "bg-primary",         line: "#a4a5ff", glow: "shadow-[0_0_16px_rgba(164,165,255,0.6)]" },
};

const RELATION_LABELS: Record<NodeRelation, string> = {
  self: "You",
  friend: "Friend",
  local: "Local (mDNS)",
  tunnel: "Tunnel",
  mesh: "Mesh Known",
  speculative: "Speculative",
  center: "Perspective Center",
};

const CONFIDENCE_ICON: Record<string, { icon: string; color: string }> = {
  SelfVerified:    { icon: "verified",      color: "text-secondary" },
  TunnelVerified:  { icon: "shield",        color: "text-primary" },
  ClusterVerified: { icon: "check_circle",  color: "text-on-surface-variant" },
  Speculative:     { icon: "help_outline",  color: "text-outline-variant" },
};

/* ── Bubble Layout ─────────────────────────────────────────────── */

interface BubblePosition {
  x: number;
  y: number;
  node: PerspectiveNode;
  size: number;
}

function computeBubbleLayout(
  nodes: PerspectiveNode[],
  width: number,
  height: number,
): BubblePosition[] {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(cx, cy) * 0.85;

  // Group by relation for ring-based layout
  const groups: Record<string, PerspectiveNode[]> = {};
  for (const n of nodes) {
    const key = n.relation;
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(n);
  }

  const positions: BubblePosition[] = [];
  const ringOrder: NodeRelation[] = ["friend", "local", "tunnel", "mesh", "speculative"];

  for (const relation of ringOrder) {
    const group = groups[relation];
    if (!group || group.length === 0) continue;

    // Use the average distance for ring radius
    const avgDist = group.reduce((s, n) => s + n.distance, 0) / group.length;
    const radius = avgDist * maxRadius;
    const count = group.length;
    const angleStep = (2 * Math.PI) / count;
    // Deterministic offset per ring to avoid overlap
    const offset = relation === "friend" ? 0.3 : relation === "local" ? 1.1 : relation === "tunnel" ? 2.2 : relation === "mesh" ? 3.5 : 4.8;

    for (let i = 0; i < count; i++) {
      const node = group[i]!;
      const angle = offset + i * angleStep;
      // Slight variance from peerId for organic feel
      const charCode = node.peerId.charCodeAt(10) ?? 0;
      const variance = 1 + ((charCode % 20) - 10) / 100;

      const baseSize = node.isServerClass ? 14 : node.relation === "friend" ? 12 : node.relation === "speculative" ? 6 : 10;
      const size = Math.round(baseSize * (1 + node.prominence * 0.4));

      positions.push({
        x: cx + Math.cos(angle) * radius * variance,
        y: cy + Math.sin(angle) * radius * variance,
        node,
        size,
      });
    }
  }

  return positions;
}

/* ── Breadcrumb ────────────────────────────────────────────────── */

interface BreadcrumbEntry {
  peerId: string;
  displayName: string | null;
  depth: number;
}

function PerspectiveBreadcrumb({
  chain,
  onNavigate,
}: {
  chain: BreadcrumbEntry[];
  onNavigate: (peerId: string | null) => void;
}) {
  if (chain.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chain.map((entry, i) => (
        <div key={entry.peerId} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="material-symbols-outlined text-xs text-on-surface-variant/40">
              chevron_right
            </span>
          )}
          <button
            onClick={() => onNavigate(i === 0 ? null : entry.peerId)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-label font-bold uppercase tracking-wider transition-all ${
              i === chain.length - 1
                ? "bg-primary/15 text-primary border border-primary/20"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50"
            }`}
          >
            {i === 0 && (
              <span className="material-symbols-outlined text-xs mr-1 align-middle">home</span>
            )}
            {entry.displayName ?? shortenPeerId(entry.peerId)}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Node Tooltip ──────────────────────────────────────────────── */

function NodeTooltip({
  node,
  onClose,
  onShiftPerspective,
}: {
  node: PerspectiveNode;
  onClose: () => void;
  onShiftPerspective: (peerId: string) => void;
}) {
  const ci = CONFIDENCE_ICON[node.confidence] ?? CONFIDENCE_ICON.Speculative!;
  const colors = RELATION_COLORS[node.relation] ?? RELATION_COLORS.speculative;

  return (
    <GlassPanel className="p-4 rounded-xl min-w-[240px] space-y-3 border border-outline-variant/20 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="font-headline text-sm font-bold text-on-surface">
          {node.displayName ?? shortenPeerId(node.peerId)}
        </span>
        <button
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <div className="space-y-2">
        {/* Badges row: relation + trust */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-label font-semibold uppercase tracking-wider bg-surface-container-high/50 text-on-surface-variant border-outline-variant/20`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
            {RELATION_LABELS[node.relation] ?? node.relation}
          </span>
          <TrustBadge level={trustLevelFromRating(node.trustRating)} size="sm" />
        </div>

        <div className="text-[11px] font-body text-on-surface-variant space-y-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-xs">fingerprint</span>
            <span className="truncate max-w-[160px]">{shortenPeerId(node.peerId)}</span>
          </div>
          {node.rttMs !== null && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xs">speed</span>
              <span>{node.rttMs}ms latency</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className={`material-symbols-outlined text-xs ${ci.color}`}>{ci.icon}</span>
            <span className={ci.color}>
              {node.confidence.replace(/([A-Z])/g, " $1").trim()}
            </span>
          </div>
          {node.routeCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xs">route</span>
              <span>{node.routeCount} routes</span>
            </div>
          )}
          {node.trustRating !== null && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xs">star</span>
              <span>Trust: {(node.trustRating * 100).toFixed(0)}%</span>
            </div>
          )}
          {(() => {
            const eng = engagementLabel(node.engagementScore);
            if (!eng) return null;
            return (
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xs">equalizer</span>
                <span className={eng.color}>{eng.text} ({node.engagementScore! > 0 ? "+" : ""}{node.engagementScore})</span>
              </div>
            );
          })()}
          {node.portalUrl && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xs">language</span>
              <span className="truncate max-w-[160px]">{node.portalUrl}</span>
            </div>
          )}
        </div>
      </div>

      {/* Prominence bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-surface-container-high overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/60"
            style={{ width: `${Math.round(node.prominence * 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-on-surface-variant font-mono">
          {Math.round(node.prominence * 100)}%
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {node.isKnown && node.relation !== "self" && (
          <button
            onClick={() => onShiftPerspective(node.peerId)}
            className="flex-1 text-center text-[10px] font-label font-semibold uppercase tracking-wider text-primary hover:text-primary-dim transition-colors py-1.5 rounded-lg bg-primary/10 hover:bg-primary/15"
          >
            <span className="material-symbols-outlined text-xs mr-1 align-middle">explore</span>
            View Perspective
          </button>
        )}
        {!node.isKnown && (
          <span className="flex-1 text-center text-[10px] font-label text-on-surface-variant/50 py-1.5">
            Unknown node — cannot shift
          </span>
        )}
      </div>
    </GlassPanel>
  );
}

/* ── Place Card ────────────────────────────────────────────────── */

function PlaceCard({ place }: { place: PlaceFrontend }) {
  return (
    <GlassPanel className="rounded-xl p-3 space-y-1.5 border border-outline-variant/10 hover:bg-surface-container-high/30 transition-colors">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-primary-fixed">location_city</span>
        <span className="font-headline text-xs font-bold text-on-surface truncate">
          {place.name}
        </span>
      </div>
      <div className="text-[10px] text-on-surface-variant flex items-center gap-3">
        <span>{place.memberCount} members</span>
        <span className="text-outline-variant">|</span>
        <span>{place.governance}</span>
        <span className="text-outline-variant">|</span>
        <span>{place.visibility}</span>
      </div>
    </GlassPanel>
  );
}

/* ── Legend ─────────────────────────────────────────────────────── */

function MapLegend() {
  const items: { relation: NodeRelation; label: string }[] = [
    { relation: "self", label: "Your Node" },
    { relation: "friend", label: "Friends" },
    { relation: "local", label: "Local (mDNS)" },
    { relation: "tunnel", label: "Tunnel Peers" },
    { relation: "mesh", label: "Mesh Known" },
    { relation: "speculative", label: "Speculative" },
  ];

  return (
    <GlassPanel className="rounded-xl p-4 border border-outline-variant/10 shadow-xl">
      <h3 className="font-headline text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-3 font-bold">
        Legend
      </h3>
      <div className="flex flex-col gap-2.5">
        {items.map(({ relation, label }) => {
          const colors = RELATION_COLORS[relation];
          return (
            <div key={relation} className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${colors.dot} ${colors.glow}`} />
              <span className="text-[11px] font-semibold tracking-wide text-on-surface-variant">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}

/* ── Stats ──────────────────────────────────────────────────────── */

function PerspectiveStats({ view }: { view: PerspectiveViewPayload }) {
  const friendCount = view.nodes.filter((n) => n.relation === "friend").length;
  const localCount = view.nodes.filter((n) => n.relation === "local").length;
  const tunnelCount = view.nodes.filter((n) => n.relation === "tunnel").length;
  const totalKnown = view.nodes.filter((n) => n.isKnown).length;
  const totalSpeculative = view.nodes.filter((n) => !n.isKnown).length;

  // Signal quality from tunnel RTTs
  const tunnelNodes = view.nodes.filter((n) => n.rttMs !== null);
  const avgRtt = tunnelNodes.length > 0
    ? tunnelNodes.reduce((s, n) => s + (n.rttMs ?? 0), 0) / tunnelNodes.length
    : 0;
  const signalStrength = avgRtt < 20 ? 4 : avgRtt < 50 ? 3 : avgRtt < 100 ? 2 : 1;

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <StatPill icon="group" value={friendCount} label="Friends" color="text-secondary" />
      <StatPill icon="wifi_tethering" value={localCount + tunnelCount} label="Connected" color="text-primary" />
      <StatPill icon="visibility" value={totalKnown} label="Known" color="text-on-surface-variant" />
      {totalSpeculative > 0 && (
        <StatPill icon="visibility_off" value={totalSpeculative} label="Speculative" color="text-outline-variant" />
      )}
      {view.places.length > 0 && (
        <StatPill icon="location_city" value={view.places.length} label="Places" color="text-primary-fixed" />
      )}
      {/* Signal bars */}
      <div className="glass-panel px-3 py-2 rounded-xl border border-secondary/20 flex items-center gap-2 ml-auto">
        <div className="flex gap-0.5">
          {[1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={`w-1 h-3 rounded-full ${level <= signalStrength ? "bg-secondary" : "bg-secondary/30"}`}
            />
          ))}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-secondary">
          {signalStrength >= 3 ? "Optimal" : signalStrength >= 2 ? "Good" : "Weak"}
        </span>
      </div>
    </div>
  );
}

function StatPill({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  return (
    <div className="glass-panel px-3 py-2 rounded-xl border border-outline-variant/10 flex items-center gap-2">
      <span className={`material-symbols-outlined text-sm ${color}`}>{icon}</span>
      <span className="text-lg font-headline font-bold text-on-surface">{value}</span>
      <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
    </div>
  );
}

/* ── Speech Bubbles (Forum Map-View) ───────────────────────────── */

function SpeechBubble({
  post,
  x,
  y,
}: {
  post: ForumPost;
  x: number;
  y: number;
}) {
  const maxLen = 80;
  const truncated = post.content.length > maxLen
    ? post.content.slice(0, maxLen) + "..."
    : post.content;

  return (
    <div
      className="absolute pointer-events-none animate-fade-in"
      style={{
        left: x + 12,
        top: y - 40,
        maxWidth: Math.min(200, typeof window !== "undefined" ? window.innerWidth * 0.4 : 200),
      }}
    >
      <div className="relative glass-panel rounded-xl rounded-bl-none px-3 py-2 border border-outline-variant/15 shadow-lg">
        <div className="text-[10px] font-label font-semibold text-secondary mb-0.5">
          {post.aliasName ?? shortenPeerId(post.authorId)}
        </div>
        <div className="text-[11px] font-body text-on-surface leading-tight">
          {truncated}
        </div>
        <div className="text-[9px] text-on-surface-variant/50 mt-1">
          {formatRelativeTime(post.timestamp)}
          {post.hopCount > 0 && (
            <span className="ml-1.5 text-outline-variant">
              {post.hopCount} hop{post.hopCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Forum Chatroom View (Text List) ───────────────────────────── */

function ForumChatroomView({
  posts,
  onPost,
}: {
  posts: ForumPost[];
  onPost: (content: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    onPost(text);
    setDraft("");
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-2 px-1 pb-2">
        {posts.length === 0 && (
          <div className="text-center py-8">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/20">forum</span>
            <p className="text-xs text-on-surface-variant/40 mt-2">No forum posts in range</p>
          </div>
        )}
        {posts.map((post) => (
          <div key={post.id} className="glass-panel rounded-lg px-3 py-2 border border-outline-variant/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-label font-semibold text-secondary">
                {post.aliasName ?? shortenPeerId(post.authorId)}
              </span>
              <span className="text-[9px] text-on-surface-variant/40">
                {formatRelativeTime(post.timestamp)}
              </span>
              {post.hopCount > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-container-high text-outline-variant">
                  {post.hopCount} hop{post.hopCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-[12px] font-body text-on-surface leading-relaxed break-words">
              {post.content}
            </p>
          </div>
        ))}
      </div>

      {/* Compose */}
      <div className="glass-panel rounded-xl p-1 flex items-center border border-outline-variant/15 mt-2">
        <input
          className="bg-transparent border-none focus:ring-0 focus:outline-none text-sm w-full font-body py-2 px-3 text-on-surface placeholder:text-on-surface-variant"
          placeholder="Post to forum..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
        />
        <button
          onClick={handleSubmit}
          disabled={!draft.trim()}
          className="bg-primary hover:bg-primary-dim disabled:opacity-30 text-on-primary-fixed px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest transition-all active:scale-95 mx-1"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/* ── Forum View Toggle ─────────────────────────────────────────── */

type ForumViewMode = "map" | "chatroom" | "hidden";

/* ── Main Component ────────────────────────────────────────────── */

function NodeMapPage() {
  const [perspectiveView, setPerspectiveView] = useState<PerspectiveViewPayload | null>(null);
  const [perspectiveChain, setPerspectiveChain] = useState<BreadcrumbEntry[]>([]);
  const [selectedBubble, setSelectedBubble] = useState<PerspectiveNode | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [forumPosts, setForumPosts] = useState<ForumPost[]>([]);
  const [forumView, setForumView] = useState<ForumViewMode>("hidden");

  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 800,
    height: typeof window !== "undefined" ? window.innerHeight : 600,
  });

  // Current center peer ID (null = home)
  const currentCenter = perspectiveChain.length > 0
    ? perspectiveChain[perspectiveChain.length - 1]!.peerId
    : null;

  // Fetch perspective view + forum posts
  const fetchPerspective = useCallback(async (centerPeerId?: string) => {
    try {
      const [view, posts] = await Promise.all([
        getPerspectiveView(centerPeerId),
        getForumPosts("local", 20),
      ]);
      setPerspectiveView(view);
      setForumPosts(posts);
    } catch (err) {
      console.warn("Failed to fetch perspective view:", err);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    void fetchPerspective(currentCenter ?? undefined);
    const interval = setInterval(
      () => void fetchPerspective(currentCenter ?? undefined),
      5000,
    );
    return () => clearInterval(interval);
  }, [fetchPerspective, currentCenter]);

  // Initialize home breadcrumb when we get the first view
  useEffect(() => {
    if (perspectiveView && perspectiveChain.length === 0) {
      setPerspectiveChain([{
        peerId: perspectiveView.center.peerId,
        displayName: perspectiveView.center.displayName,
        depth: 0,
      }]);
    }
  }, [perspectiveView, perspectiveChain.length]);

  // Observe map container size
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setMapSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Navigate to a node's perspective
  const shiftPerspective = useCallback((peerId: string) => {
    const node = perspectiveView?.nodes.find((n) => n.peerId === peerId);
    if (!node?.isKnown) return;

    // Check if we're going back in the chain
    const existingIdx = perspectiveChain.findIndex((e) => e.peerId === peerId);
    if (existingIdx >= 0) {
      // Navigate back to this point in the chain
      setPerspectiveChain(perspectiveChain.slice(0, existingIdx + 1));
    } else {
      // Push new perspective
      setPerspectiveChain((prev) => [
        ...prev,
        { peerId, displayName: node.displayName, depth: prev.length },
      ]);
    }
    setSelectedBubble(null);
  }, [perspectiveView, perspectiveChain]);

  // Navigate via breadcrumb
  const handleBreadcrumbNavigate = useCallback((peerId: string | null) => {
    if (peerId === null) {
      // Go home
      setPerspectiveChain((prev) => prev.slice(0, 1));
    } else {
      const idx = perspectiveChain.findIndex((e) => e.peerId === peerId);
      if (idx >= 0) {
        setPerspectiveChain(perspectiveChain.slice(0, idx + 1));
      }
    }
    setSelectedBubble(null);
  }, [perspectiveChain]);

  // Calculate bubble positions
  const bubblePositions = useMemo(
    () => perspectiveView ? computeBubbleLayout(perspectiveView.nodes, mapSize.width, mapSize.height) : [],
    [perspectiveView, mapSize.width, mapSize.height],
  );

  // Search filter
  const filteredBubbles = useMemo(() => {
    if (!searchValue.trim()) return bubblePositions;
    const q = searchValue.toLowerCase();
    return bubblePositions.filter(
      (b) =>
        b.node.peerId.toLowerCase().includes(q) ||
        (b.node.displayName?.toLowerCase().includes(q) ?? false),
    );
  }, [bubblePositions, searchValue]);

  // Map recent forum posts to bubble positions (for speech bubbles)
  const postBubbles = useMemo(() => {
    if (forumView !== "map") return [];
    // Only show the most recent post per author, max 6 bubbles
    const posMap = new Map(bubblePositions.map((b) => [b.node.peerId, b]));
    const seen = new Set<string>();
    const result: { post: ForumPost; bubble: BubblePosition }[] = [];
    const sortedPosts = [...forumPosts].sort((a, b) => b.timestamp - a.timestamp);
    for (const post of sortedPosts) {
      if (seen.has(post.authorId) || result.length >= 6) break;
      const bubble = posMap.get(post.authorId);
      if (bubble) {
        seen.add(post.authorId);
        result.push({ post, bubble });
      }
    }
    return result;
  }, [forumPosts, bubblePositions, forumView]);

  // Handle posting to forum
  const handleForumPost = useCallback(async (content: string) => {
    try {
      await postToLocalForum(content);
      // Re-fetch to include new post
      const posts = await getForumPosts("local", 20);
      setForumPosts(posts);
    } catch (err) {
      console.warn("Failed to post to forum:", err);
    }
  }, []);

  const handleLocate = useCallback(() => {
    if (!searchValue.trim()) return;
    const found = bubblePositions.find(
      (b) =>
        b.node.peerId.toLowerCase().includes(searchValue.toLowerCase()) ||
        (b.node.displayName?.toLowerCase().includes(searchValue.toLowerCase()) ?? false),
    );
    if (found) {
      setSelectedBubble(found.node);
    }
  }, [searchValue, bubblePositions]);

  // Tooltip positioning
  const getTooltipStyle = useCallback(
    (bubble: BubblePosition): React.CSSProperties => {
      const tooltipW = 260;
      const tooltipH = 280;
      let left = bubble.x + bubble.size + 8;
      let top = bubble.y - 20;
      if (left + tooltipW > mapSize.width) left = bubble.x - tooltipW - 8;
      if (top + tooltipH > mapSize.height) top = mapSize.height - tooltipH - 10;
      if (top < 10) top = 10;
      return { left, top };
    },
    [mapSize.width, mapSize.height],
  );

  const cx = mapSize.width / 2;
  const cy = mapSize.height / 2;

  if (initialLoading || !perspectiveView) {
    return (
      <main className="relative flex-grow w-full h-full overflow-hidden bg-surface">
        <div className="absolute inset-0 mesh-background" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-4 relative z-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-4xl text-primary/40 animate-pulse">
                explore
              </span>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-5 w-40 mx-auto" />
              <Skeleton className="h-3 w-56 mx-auto" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const selectedBubblePos = selectedBubble
    ? bubblePositions.find((b) => b.node.peerId === selectedBubble.peerId)
    : null;

  return (
    <main className="relative flex-grow w-full h-full overflow-hidden">
      {/* Map canvas */}
      <div ref={mapRef} className="absolute inset-0 z-0 bg-surface">
        <div className="absolute inset-0 mesh-background" />
        <div className="absolute inset-0 map-gradient" />

        {/* SVG connection lines from center to each bubble */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {filteredBubbles.map((bubble) => {
            const colors = RELATION_COLORS[bubble.node.relation] ?? RELATION_COLORS.speculative;
            const isSpec = bubble.node.relation === "speculative";
            return (
              <line
                key={`line-${bubble.node.peerId}`}
                x1={cx}
                y1={cy}
                x2={bubble.x}
                y2={bubble.y}
                stroke={colors.line}
                strokeWidth={bubble.node.relation === "friend" ? 1.5 : 1}
                opacity={isSpec ? 0.12 : 0.25}
                strokeDasharray={isSpec ? "4 4" : bubble.node.relation === "mesh" ? "2 3" : undefined}
              />
            );
          })}
        </svg>

        {/* Center node (pulsing) */}
        <div
          className="absolute w-5 h-5 rounded-full bg-primary node-dot-pulse z-10"
          style={{ left: cx - 10, top: cy - 10 }}
          title={perspectiveView.center.displayName ?? "Center Node"}
        />
        {/* Center label */}
        <div
          className="absolute z-10 text-center pointer-events-none"
          style={{ left: cx - 60, top: cy + 14, width: 120 }}
        >
          <span className="text-[10px] font-label font-bold uppercase tracking-widest text-primary/70">
            {perspectiveView.center.displayName ?? shortenPeerId(perspectiveView.center.peerId)}
          </span>
        </div>

        {/* Bubble nodes */}
        {filteredBubbles.map((bubble) => {
          const colors = RELATION_COLORS[bubble.node.relation] ?? RELATION_COLORS.speculative;
          const opacity = bubble.node.confidence === "SelfVerified" ? 0.95
            : bubble.node.confidence === "TunnelVerified" ? 0.85
            : bubble.node.confidence === "ClusterVerified" ? 0.7
            : 0.35;
          const isSelected = selectedBubble?.peerId === bubble.node.peerId;
          const ringClass = bubble.node.isKnown
            ? "ring-1 ring-offset-1 ring-offset-surface ring-primary/30"
            : "";

          // Touch target is 44px minimum for mobile, visual dot is smaller
          const touchSize = Math.max(bubble.size, 44);
          const touchHalf = touchSize / 2;
          return (
            <button
              key={`dot-${bubble.node.peerId}`}
              className={`absolute flex items-center justify-center transition-all duration-200 ${
                bubble.node.isKnown ? "cursor-pointer" : "cursor-default"
              }`}
              style={{
                left: bubble.x - touchHalf,
                top: bubble.y - touchHalf,
                width: touchSize,
                height: touchSize,
              }}
              onClick={() => setSelectedBubble(isSelected ? null : bubble.node)}
            >
              <span
                className={`rounded-full ${colors.dot} ${colors.glow} ${ringClass} transition-transform duration-200 ${
                  bubble.node.isKnown ? "hover:scale-150" : ""
                } ${isSelected ? "scale-150 ring-2 ring-primary" : ""}`}
                style={{
                  width: bubble.size,
                  height: bubble.size,
                  opacity,
                  display: "block",
                }}
              />
            </button>
          );
        })}

        {/* Tooltip */}
        {selectedBubble && selectedBubblePos && (
          <div className="absolute z-50" style={getTooltipStyle(selectedBubblePos)}>
            <NodeTooltip
              node={selectedBubble}
              onClose={() => setSelectedBubble(null)}
              onShiftPerspective={shiftPerspective}
            />
          </div>
        )}

        {/* Speech bubbles (forum map-view) */}
        {postBubbles.map(({ post, bubble }) => (
          <SpeechBubble
            key={post.id}
            post={post}
            x={bubble.x}
            y={bubble.y}
          />
        ))}
      </div>

      {/* Floating UI overlays */}
      <div className="relative z-10 w-full h-full pointer-events-none p-4 md:p-8 flex flex-col justify-between">
        {/* Top: Breadcrumb + Search + Legend */}
        <div className="flex flex-col gap-4">
          {/* Breadcrumb */}
          <div className="pointer-events-auto">
            <PerspectiveBreadcrumb
              chain={perspectiveChain}
              onNavigate={handleBreadcrumbNavigate}
            />
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            {/* Search */}
            <div className="w-full md:w-96 pointer-events-auto">
              <div className="glass-panel rounded-xl p-1 flex items-center shadow-2xl border border-outline-variant/15">
                <div className="pl-3 pr-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-lg">search</span>
                </div>
                <input
                  className="bg-transparent border-none focus:ring-0 focus:outline-none text-sm w-full font-body py-2.5 text-on-surface placeholder:text-on-surface-variant"
                  placeholder="Find a node..."
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleLocate(); }}
                />
                <button
                  onClick={handleLocate}
                  className="bg-primary hover:bg-primary-dim text-on-primary-fixed px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest transition-all active:scale-95 mx-1 whitespace-nowrap"
                >
                  Locate
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="pointer-events-auto hidden md:block">
              <MapLegend />
            </div>
          </div>
        </div>

        {/* Bottom: Stats + Places */}
        <div className="flex flex-col gap-3 pointer-events-auto">
          {/* Places strip */}
          {perspectiveView.places.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {perspectiveView.places.map((place) => (
                <PlaceCard key={place.placeId} place={place} />
              ))}
            </div>
          )}

          {/* Stats */}
          <PerspectiveStats view={perspectiveView} />
        </div>
      </div>

      {/* Forum view toggle (bottom-right floating) */}
      <div className="absolute bottom-20 right-4 md:right-8 z-20 pointer-events-auto">
        <div className="glass-panel rounded-full p-1 flex gap-0.5 border border-outline-variant/15 shadow-xl">
          {(["hidden", "map", "chatroom"] as ForumViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setForumView(mode)}
              className={`px-4 py-2.5 min-w-[44px] min-h-[44px] rounded-full text-[10px] font-label font-bold uppercase tracking-widest transition-all flex items-center justify-center ${
                forumView === mode
                  ? "bg-secondary text-surface"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {mode === "hidden" ? (
                <span className="material-symbols-outlined text-xs">visibility_off</span>
              ) : mode === "map" ? (
                <span className="material-symbols-outlined text-xs">chat_bubble</span>
              ) : (
                <span className="material-symbols-outlined text-xs">forum</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Forum chatroom panel (slide-in from right, full-width on mobile) */}
      {forumView === "chatroom" && (
        <div className="absolute top-0 right-0 bottom-0 w-full sm:w-80 md:w-96 z-20 pointer-events-auto">
          <div className="glass-panel h-full border-l border-outline-variant/15 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-headline text-sm font-bold text-on-surface">
                Forum
              </h3>
              <button
                onClick={() => setForumView("hidden")}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
            <ForumChatroomView posts={forumPosts} onPost={handleForumPost} />
          </div>
        </div>
      )}
    </main>
  );
}

export default NodeMapPage;
