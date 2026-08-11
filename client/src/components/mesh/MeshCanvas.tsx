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
  /**
   * Reticulum-layer (F7a) sub-kind. When set, the node is drawn with the
   * Reticulum vocabulary instead of the plain `kind` circle:
   *   * `self` — this install's Reticulum identity (accent ring + identicon),
   *   * `infrastructure` — a transit/transport node (rounded-square, blue),
   *   * `announce-peer` — a heard destination (identicon disc),
   *   * `interface` — a local interface (online green / offline red disc).
   * `undefined` on Concord/Meshtastic nodes (drawn by `kind`).
   */
  ret?: "self" | "infrastructure" | "announce-peer" | "interface";
  /**
   * Inline `data:image/svg+xml` identicon URI (see `identicon.ts`). Drawn
   * clipped to the node disc for Reticulum `self` / `announce-peer` nodes.
   * CSP-safe (data URI only). `undefined` → no image, solid fill.
   */
  identicon?: string;
  /**
   * `true` when the node has no live path (offline). Drawn dimmed with a
   * hollow ring; its edges render dashed (crosstalk convention).
   */
  offline?: boolean;
  /**
   * Reticulum hop count to show as a small badge on the node. `undefined` →
   * no badge (Concord nodes derive position from `hop` instead).
   */
  hopBadge?: number;
  /** `true` when this Reticulum node relays for others (transport). Adds a
   * small green marker dot, mirroring crosstalk's transport indicator. */
  transportMarker?: boolean;
}

/** An undirected edge between two node ids. */
export interface MeshEdge {
  from: string;
  to: string;
  /**
   * Draw the edge dashed (crosstalk convention for a link to an offline /
   * no-live-path node). `undefined`/`false` → solid.
   */
  dashed?: boolean;
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
function radiusFor(node: MeshNode): number {
  if (node.ret) {
    if (node.ret === "self") return 20;
    if (node.ret === "infrastructure") return 17;
    return 15; // announce-peer / interface
  }
  if (node.kind === "host") return 22;
  if (node.kind === "pillar") return 17;
  return 14;
}

/** Reticulum-layer accent palette (crosstalk's established mesh vocabulary —
 * the same greens/blues/reds its NetworkVisualiser uses, so the two surfaces
 * read as one system). */
const RET = {
  online: "#2ee781",
  offline: "#ff5c72",
  infra: "#60a5fa",
  infraTransport: "#93c5fd",
} as const;

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
  // Identicon images decode asynchronously; cache the HTMLImageElement per
  // data-URI and bump `imgTick` when one finishes so the paint effect reruns
  // and draws it. Decoded from inline data: URIs only (CSP-safe).
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imgTick, setImgTick] = useState(0);
  const getImage = useCallback((uri: string): HTMLImageElement | null => {
    const cache = imageCacheRef.current;
    const existing = cache.get(uri);
    if (existing) return existing.complete ? existing : null;
    const img = new Image();
    img.onload = () => setImgTick((t) => t + 1);
    img.src = uri;
    cache.set(uri, img);
    return img.complete ? img : null;
  }, []);
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
            placed.push({ ...n, x: cx, y: cy, r: radiusFor(n) });
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
            r: radiusFor(n),
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
    const drawEdge = (a?: PlacedNode, b?: PlacedNode, dashed?: boolean) => {
      if (!a || !b) return;
      // Dashed edge for a link to an offline / no-live-path node (crosstalk
      // convention). An edge is dashed if explicitly flagged OR either
      // endpoint is an offline Reticulum node.
      const isDashed = dashed || a.offline || b.offline;
      ctx.setLineDash(isDashed ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    if (edges && edges.length > 0) {
      for (const e of edges) drawEdge(byId.get(e.from), byId.get(e.to), e.dashed);
    } else if (host) {
      for (const p of placed) {
        if (p.id !== host.id) drawEdge(host, p);
      }
    }
    ctx.setLineDash([]);

    // Draw a data-URI identicon clipped to the node disc. No-op (returns
    // false) until the image has decoded — the paint reruns via `imgTick`.
    const drawIdenticon = (p: PlacedNode, uri: string): boolean => {
      const img = getImage(uri);
      if (!img) return false;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      ctx.restore();
      return true;
    };

    const drawLabel = (p: PlacedNode) => {
      ctx.fillStyle = colorOnSurface;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label;
      ctx.fillText(label, p.x, p.y + p.r + 4);
    };

    // Nodes.
    const colorPillar = pillarColor();
    for (const p of placed) {
      // ---- Reticulum-layer node treatment (F7a) ----------------------------
      if (p.ret) {
        const online = !p.offline;
        if (p.ret === "infrastructure") {
          // Transit node: a rounded square so it reads apart from the peer
          // discs, blue border (brighter when it's a transport relay).
          const border = p.offline
            ? RET.offline
            : p.transportMarker
              ? RET.infraTransport
              : RET.infra;
          const s = p.r; // half-side
          ctx.beginPath();
          const rr = 5;
          const x0 = p.x - s;
          const y0 = p.y - s;
          const w = s * 2;
          const h = s * 2;
          ctx.moveTo(x0 + rr, y0);
          ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, rr);
          ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, rr);
          ctx.arcTo(x0, y0 + h, x0, y0, rr);
          ctx.arcTo(x0, y0, x0 + w, y0, rr);
          ctx.closePath();
          ctx.fillStyle = cssVar("--color-surface-container-high", "#1e293b");
          ctx.globalAlpha = p.offline ? 0.5 : 1;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = border;
          ctx.lineWidth = p.transportMarker ? 2.4 : 1.8;
          ctx.stroke();
        } else if (p.ret === "interface") {
          // Local interface: online green / offline red disc.
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = online ? RET.online : RET.offline;
          ctx.globalAlpha = p.offline ? 0.55 : 1;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          // self / announce-peer: identicon disc with a state-colored ring.
          const drew = p.identicon ? drawIdenticon(p, p.identicon) : false;
          if (!drew) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = colorVariant;
            ctx.globalAlpha = p.offline ? 0.5 : 1;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.strokeStyle =
            p.ret === "self"
              ? colorPrimary
              : p.offline
                ? RET.offline
                : RET.online;
          ctx.lineWidth = p.ret === "self" ? 3 : 2;
          ctx.stroke();
        }

        // Transport relay marker: a small green dot, top-right (crosstalk).
        if (p.transportMarker) {
          ctx.beginPath();
          ctx.arc(p.x + p.r * 0.7, p.y - p.r * 0.7, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = RET.online;
          ctx.fill();
          ctx.strokeStyle = colorOnSurface;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Hop-count badge, bottom-right, so distance is visible at a glance.
        if (p.hopBadge != null) {
          const bx = p.x + p.r * 0.72;
          const by = p.y + p.r * 0.72;
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fillStyle = cssVar("--color-surface-container-high", "#1e293b");
          ctx.fill();
          ctx.strokeStyle = colorOutline;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = colorOnSurface;
          ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(p.hopBadge), bx, by + 0.5);
        }

        drawLabel(p);
        continue;
      }

      // ---- Concord / Meshtastic node treatment (unchanged) -----------------
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

      drawLabel(p);
    }
  }, [size, layout, edges, imgTick, getImage]);

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
