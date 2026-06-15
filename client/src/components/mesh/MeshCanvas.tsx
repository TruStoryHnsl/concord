/**
 * MeshCanvas — shared 2D node-graph renderer for Concord's mesh surfaces.
 *
 * W0.3 / F1 builds this as the LAN-discovery renderer (host at center,
 * LAN peers as a ring of nodes at hop=1). It is deliberately generic so
 * F2's full mesh map (N-hop, force-directed, layer toggles) can reuse the
 * SAME component — F2 supplies a richer node/edge set with hop distances
 * and the renderer lays them out by hop ring. There is no LAN-specific
 * logic in here; callers pass plain [`MeshNode`] / [`MeshEdge`] data.
 *
 * Rendering uses an HTML5 `<canvas>`, NOT a DOM-per-node tree, so it stays
 * cheap on mobile where the spec calls out canvas perf as the F2 risk. A
 * hard [`nodeCap`] bounds how many nodes are drawn (excess are dropped with
 * a "+N more" affordance) so a pathological mesh can never blow up the
 * paint budget. Layout is a deterministic concentric-ring placement keyed
 * by `hop` — no physics simulation yet (force-directed layout is an F2
 * enhancement that can swap in behind this same prop contract).
 *
 * The canvas is HiDPI-aware (scales the backing store by devicePixelRatio)
 * and re-renders on container resize via a ResizeObserver. Clicking a node
 * fires `onNodeClick` with the node id — the LAN map uses this for a
 * future "pair this peer" affordance; F2 will use it for node inspection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** A single node in the mesh graph. */
export interface MeshNode {
  /** Stable unique id (peer id for Concord nodes). */
  id: string;
  /** Short display label drawn under the node. */
  label: string;
  /**
   * Hops from the local host. `0` = this device (drawn at center), `1` =
   * directly-reachable peers (the LAN case), `2+` = farther nodes (F2).
   */
  hop: number;
  /**
   * Visual emphasis. `host` is the center node; `paired` peers are drawn
   * with the primary accent; `known` with a muted accent; `unknown` plain.
   * `pillar` (Spec B) is a web-threaded peer relayed through a docker
   * pillar — drawn in a distinct color and slightly larger than a regular
   * peer so it reads as "reachable through the pillar". F2 layers can add
   * more variants without breaking this contract.
   */
  kind: "host" | "paired" | "known" | "unknown" | "pillar";
}

/** An undirected edge between two node ids. */
export interface MeshEdge {
  from: string;
  to: string;
}

export interface MeshCanvasProps {
  nodes: MeshNode[];
  /**
   * Edges to draw. Optional — when omitted, every non-host node is
   * implicitly connected to the host (the LAN star topology). F2 supplies
   * explicit edges for the real mesh graph.
   */
  edges?: MeshEdge[];
  /**
   * Maximum nodes to render. Excess nodes (beyond the host) are dropped
   * and surfaced as a "+N more" count. Defaults to 60 — comfortably above
   * a typical LAN while bounding the mobile paint cost.
   */
  nodeCap?: number;
  /** Fired with the node id when a node is clicked. */
  onNodeClick?: (id: string) => void;
}

/** Resolve a CSS custom-property color to a concrete value for canvas use. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

interface PlacedNode extends MeshNode {
  x: number;
  y: number;
  r: number;
}

/** Node radius in CSS pixels by kind. Host is largest; web-threaded
 * pillar peers are drawn slightly larger than a regular peer so they
 * stand out as relayed-through-the-pillar nodes. */
function radiusFor(kind: MeshNode["kind"]): number {
  if (kind === "host") return 22;
  if (kind === "pillar") return 17;
  return 14;
}

/** Distinct accent for web-threaded pillar peers (Spec B). Falls back to a
 * teal that reads apart from the primary (host/paired) and variant
 * (known) colors regardless of theme. */
function pillarColor(): string {
  return cssVar("--color-tertiary", "#2dd4bf");
}

const DEFAULT_NODE_CAP = 60;

export function MeshCanvas({
  nodes,
  edges,
  nodeCap = DEFAULT_NODE_CAP,
  onNodeClick,
}: MeshCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Placed nodes are stashed so the click handler can hit-test without
  // recomputing layout — the same array the last paint used.
  const placedRef = useRef<PlacedNode[]>([]);

  // Cap the node set: always keep the host, then the first (nodeCap-1)
  // others. Excess count drives the "+N more" overlay.
  const { capped, overflow } = useMemo(() => {
    const host = nodes.filter((n) => n.kind === "host");
    const rest = nodes.filter((n) => n.kind !== "host");
    const room = Math.max(0, nodeCap - host.length);
    const keptRest = rest.slice(0, room);
    return {
      capped: [...host, ...keptRest],
      overflow: rest.length - keptRest.length,
    };
  }, [nodes, nodeCap]);

  // Observe container size so the canvas backing store tracks layout.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setSize({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Concentric-ring layout: host at center, each hop on its own ring.
  // Deterministic angular placement so nodes don't jump between renders
  // when the set is stable.
  const layout = useCallback(
    (w: number, h: number): PlacedNode[] => {
      const cx = w / 2;
      const cy = h / 2;
      const maxHop = capped.reduce((m, n) => Math.max(m, n.hop), 0);
      // Ring spacing leaves margin for the largest node + its label.
      const ringStep = Math.max(
        70,
        (Math.min(w, h) / 2 - 40) / Math.max(1, maxHop),
      );

      const byHop = new Map<number, MeshNode[]>();
      for (const n of capped) {
        const arr = byHop.get(n.hop) ?? [];
        arr.push(n);
        byHop.set(n.hop, arr);
      }

      const placed: PlacedNode[] = [];
      for (const [hop, group] of byHop) {
        if (hop === 0) {
          for (const n of group) {
            placed.push({ ...n, x: cx, y: cy, r: radiusFor(n.kind) });
          }
          continue;
        }
        const ring = ringStep * hop;
        const count = group.length;
        group.forEach((n, i) => {
          // Offset each ring's start angle a little so rings don't all
          // align spokes — purely cosmetic.
          const angle = (i / count) * Math.PI * 2 - Math.PI / 2 + hop * 0.4;
          placed.push({
            ...n,
            x: cx + Math.cos(angle) * ring,
            y: cy + Math.sin(angle) * ring,
            r: radiusFor(n.kind),
          });
        });
      }
      return placed;
    },
    [capped],
  );

  // Paint pass. Runs on every size / data change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);

    const placed = layout(size.w, size.h);
    placedRef.current = placed;
    const byId = new Map(placed.map((p) => [p.id, p]));

    // Resolve theme colors once per paint.
    const colorPrimary = cssVar("--color-primary", "#a4a5ff");
    const colorVariant = cssVar("--color-on-surface-variant", "#94a3b8");
    const colorOutline = cssVar("--color-outline-variant", "#334155");
    const colorOnSurface = cssVar("--color-on-surface", "#e2e8f0");

    // Edges first so nodes paint on top. Explicit edges if given, else a
    // star from the host to every other node (the LAN default).
    ctx.lineWidth = 1;
    ctx.strokeStyle = colorOutline;
    const host = placed.find((p) => p.kind === "host");
    const drawEdge = (a?: PlacedNode, b?: PlacedNode) => {
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    if (edges && edges.length > 0) {
      for (const e of edges) drawEdge(byId.get(e.from), byId.get(e.to));
    } else if (host) {
      for (const p of placed) {
        if (p.id !== host.id) drawEdge(host, p);
      }
    }

    // Nodes.
    const colorPillar = pillarColor();
    for (const p of placed) {
      const fill =
        p.kind === "host" || p.kind === "paired"
          ? colorPrimary
          : p.kind === "pillar"
            ? colorPillar
            : p.kind === "known"
              ? colorVariant
              : colorOutline;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      // Unknown peers get a hollow ring so they read as "not yet trusted".
      if (p.kind === "unknown") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = colorVariant;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label under the node, clipped to a reasonable width.
      ctx.fillStyle = colorOnSurface;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label;
      ctx.fillText(label, p.x, p.y + p.r + 4);
    }
  }, [size, layout, edges]);

  // Hit-test clicks against the last painted node positions.
  const handleClick = useCallback(
    (ev: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onNodeClick) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      // Topmost (last-drawn) hit wins; iterate in reverse.
      for (let i = placedRef.current.length - 1; i >= 0; i--) {
        const p = placedRef.current[i];
        const dx = x - p.x;
        const dy = y - p.y;
        if (dx * dx + dy * dy <= p.r * p.r) {
          onNodeClick(p.id);
          return;
        }
      }
    },
    [onNodeClick],
  );

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-0">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className={onNodeClick ? "cursor-pointer" : undefined}
        data-testid="mesh-canvas"
      />
      {overflow > 0 && (
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-surface-container-high text-xs text-on-surface-variant font-label">
          +{overflow} more
        </div>
      )}
    </div>
  );
}
