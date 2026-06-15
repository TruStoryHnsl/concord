"""Mesh-topology surface for the web / docker build (Feature F2, web bridge).

## Why this exists

On a native desktop/mobile install, the mesh map renders from the Rust
servitude's in-process libp2p ``MeshGraph`` (the ``mesh_graph_snapshot``
Tauri command). The browser / docker build has no Tauri bridge, so the
map used to hard-return a "web mode" placeholder — the docker node, the
one piece of infrastructure that is *always on* and acts as the mesh's
relay + backup "big brother", showed nothing.

This router gives the browser a real topology to render. It assembles a
``MeshGraph`` in the **exact wire shape** the client's ``MeshGraph`` type
expects (``nodes`` with ``peer_id`` + ``hop_distance``, undirected
``edges``) from what the docker node *genuinely knows*:

  * **hop 0** — this instance itself (the docker hub). Its node id is the
    instance's Matrix ``server_name`` (``CONDUWUIT_SERVER_NAME``) — the
    stable public identity a docker node advertises. This is the node the
    map centers on.
  * **hop 1** — every homeserver this node federates with, read live from
    the federation allowlist (the same ``tuwunel.toml`` state the
    ``/api/explore/servers`` card list projects). These are the docker
    node's real neighbors on the federation mesh.
  * **edges** — ``(local, neighbor)`` for each federated neighbor. The
    docker hub sits at the center; its federation peers ring it at hop 1.

That is a faithful view of the mesh *as the docker node observes it* — not
an invented placeholder. A node with an empty allowlist (fresh install)
yields just the hop-0 self node, which the map renders as a lone host —
the correct "no mesh peers yet" state.

## Forward-compat with a headless Rust servitude

If a future deployment runs the Rust servitude headless (writing its
real libp2p ``MeshGraph`` to ``<data_dir>/mesh_snapshot.json`` on a
timer), this endpoint prefers that file when it is present and fresh —
the richer N-hop libp2p topology supersedes the federation-derived view
transparently, with no client change. Until that lands, the
federation-derived graph is the real, shippable surface. See
``_load_rust_snapshot``.

## Hub role (relay + backup) metadata

The docker node's "big brother" role is surfaced in the same response so
the map can show *why* this node matters:

  * ``hub_enabled`` — ``CONCORD_HUB`` is truthy (the node relays mesh
    traffic and accepts encrypted superuser-keychain backups).
  * ``relay`` — whether this node relays for the mesh (true iff hub).
  * ``backup_blob_count`` — how many encrypted backup blobs the hub
    currently holds, counted from the ``hub_keystore/`` directory. This
    is a COUNT ONLY — never the hero identities, never the ciphertext.
    The ciphertext-only invariant is not weakened: this router never
    reads, decrypts, or exposes a single blob's contents.

## Security / privacy

This endpoint is intentionally unauthenticated (like ``/.well-known``):
it reveals only the instance's own public-facing federation posture —
its server name and the allowlist it already advertises via well-known
discovery — plus boolean role flags and an opaque backup *count*. No
user data, no private keys, no blob identities, no ciphertext. It is a
read-only projection; it never mutates state.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

from config import DATA_DIR, MATRIX_SERVER_NAME
from services.tuwunel_config import (
    decode_server_name_patterns,
    read_federation,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mesh", tags=["mesh"])

# Sub-directory under the data dir where the Rust Hub keystore stores its
# opaque per-hero ciphertext blobs. MUST stay in lockstep with the Rust
# constant ``HUB_KEYSTORE_DIRNAME`` in
# ``src-tauri/src/servitude/hub/mod.rs``. Each blob is a single
# ``<hero_pubkey_hex>.blob`` file.
HUB_KEYSTORE_DIRNAME = "hub_keystore"

# File a future headless Rust servitude may write its real libp2p
# ``MeshGraph`` snapshot to, on a timer. When present and fresh, it
# supersedes the federation-derived graph. MUST match the Rust writer's
# path if/when that lands.
RUST_SNAPSHOT_FILENAME = "mesh_snapshot.json"

# A Rust snapshot older than this many seconds is treated as stale and
# ignored (the servitude died / stopped writing) — we fall back to the
# always-correct federation-derived graph rather than render a frozen
# view. The Rust writer is expected to refresh every few seconds.
RUST_SNAPSHOT_MAX_AGE_SECS = 30.0


# ---------------------------------------------------------------------------
# Wire models — MUST match the client ``MeshGraph`` type
# (client/src/api/meshGraph.ts). snake_case on the wire; the client maps
# ``peer_id`` -> ``peerId`` and ``hop_distance`` -> ``hopDistance``.
# ---------------------------------------------------------------------------

class MeshGraphNode(BaseModel):
    """One node in the assembled mesh graph (wire shape)."""

    peer_id: str = Field(..., description="Stable node id (base58 PeerId on "
                         "native; Matrix server_name on the web/docker bridge).")
    hop_distance: int | None = Field(
        ...,
        description="BFS hop distance from the local node: 0 = this node, "
                    "1 = direct neighbor, null = unreachable island.",
    )


class MeshGraphEdge(BaseModel):
    """One undirected edge (endpoints lexicographically ordered)."""

    a: str
    b: str


class MeshTopologyResponse(BaseModel):
    """Full mesh-topology snapshot + this node's hub (relay/backup) role.

    ``nodes`` + ``edges`` are the ``MeshGraph`` the client renders. The
    remaining fields describe the docker node's infrastructure role so
    the map can surface the relay/backup "big brother" status.
    """

    nodes: list[MeshGraphNode]
    edges: list[MeshGraphEdge]
    # Hub-role metadata (relay + backup). Never exposes blob identities or
    # ciphertext — only booleans and an opaque count.
    hub_enabled: bool = Field(
        ..., description="True when CONCORD_HUB is set — this node relays "
                         "mesh traffic and stores encrypted backups."
    )
    relay: bool = Field(
        ..., description="True when this node relays for the mesh (== hub)."
    )
    backup_blob_count: int = Field(
        ..., description="Count of encrypted backup blobs held (count only — "
                         "never identities or ciphertext)."
    )
    # ``source`` tells the client where the graph came from, for diagnostics
    # / future UI. ``rust_snapshot`` = real libp2p topology from a headless
    # servitude; ``federation`` = the docker node's federation-derived view.
    source: str = Field(..., description="'rust_snapshot' or 'federation'.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hub_enabled() -> bool:
    """Whether ``CONCORD_HUB`` is truthy.

    Mirrors the Rust ``HubConfig::parse_truthy`` truthy set exactly so the
    web view of the hub role matches what the Rust side would decide.
    """
    raw = os.getenv("CONCORD_HUB", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _backup_blob_count() -> int:
    """Count encrypted backup blobs the hub holds, by listing
    ``<data_dir>/hub_keystore/*.blob``.

    COUNT ONLY. This never opens, reads, decrypts, or exposes a blob — it
    only counts files matching the keystore's ``*.blob`` naming, preserving
    the ciphertext-only invariant. Missing directory (no claims yet) -> 0.
    """
    keystore = DATA_DIR / "concord" / HUB_KEYSTORE_DIRNAME
    # The Rust side resolves the keystore under its own data dir. In the
    # single-image layout that is ``/data/concord/hub_keystore``; DATA_DIR
    # is ``/data`` there, so ``DATA_DIR / "concord" / ...`` matches. If a
    # deployment points CONCORD_DATA_DIR straight at the concord dir, also
    # try the direct sibling.
    candidates = [keystore, DATA_DIR / HUB_KEYSTORE_DIRNAME]
    for path in candidates:
        try:
            if path.is_dir():
                return sum(1 for p in path.iterdir() if p.suffix == ".blob")
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("mesh: failed to stat keystore %s: %s", path, exc)
    return 0


def _rust_snapshot_path() -> Path:
    """Resolve the headless-servitude snapshot path (forward-compat)."""
    return DATA_DIR / "concord" / RUST_SNAPSHOT_FILENAME


def _load_rust_snapshot() -> tuple[list[MeshGraphNode], list[MeshGraphEdge]] | None:
    """Load a fresh Rust-written ``mesh_snapshot.json`` if one exists.

    Returns the parsed nodes/edges when the file is present, recent, and
    structurally valid; otherwise ``None`` so the caller falls back to the
    federation-derived graph. Any parse/IO error is swallowed (logged) and
    treated as "no snapshot" — a corrupt file must never break the map.
    """
    path = _rust_snapshot_path()
    try:
        if not path.is_file():
            return None
        age = time.time() - path.stat().st_mtime
        if age > RUST_SNAPSHOT_MAX_AGE_SECS:
            logger.debug("mesh: rust snapshot stale (%.1fs old), ignoring", age)
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("mesh: failed to read rust snapshot %s: %s", path, exc)
        return None

    raw_nodes = raw.get("nodes")
    raw_edges = raw.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        logger.warning("mesh: rust snapshot has no nodes/edges arrays")
        return None

    nodes: list[MeshGraphNode] = []
    for n in raw_nodes:
        if not isinstance(n, dict):
            continue
        peer_id = n.get("peer_id")
        if not isinstance(peer_id, str) or not peer_id:
            continue
        hop = n.get("hop_distance")
        nodes.append(
            MeshGraphNode(
                peer_id=peer_id,
                hop_distance=hop if isinstance(hop, int) else None,
            )
        )
    edges: list[MeshGraphEdge] = []
    for e in raw_edges:
        if not isinstance(e, dict):
            continue
        a, b = e.get("a"), e.get("b")
        if isinstance(a, str) and isinstance(b, str) and a and b:
            edges.append(MeshGraphEdge(a=a, b=b))
    return nodes, edges


def build_federation_graph(
    local_server_name: str,
    neighbor_hostnames: list[str],
) -> tuple[list[MeshGraphNode], list[MeshGraphEdge]]:
    """Assemble the federation-derived ``MeshGraph`` (pure / unit-testable).

    ``local_server_name`` is the hop-0 center node. Each entry in
    ``neighbor_hostnames`` becomes a hop-1 node with an undirected edge to
    local. The local host is always present (the map must always have its
    center) — even when there are no neighbors. Neighbors are deduped and
    the local name is never also listed as a neighbor (no self-loop).

    Edges are emitted with endpoints lexicographically ordered to match
    the Rust ``MeshGraph`` edge convention the client already consumes.
    """
    local = (local_server_name or "localhost").strip() or "localhost"
    nodes: list[MeshGraphNode] = [MeshGraphNode(peer_id=local, hop_distance=0)]
    edges: list[MeshGraphEdge] = []

    seen: set[str] = {local}
    for host in neighbor_hostnames:
        h = (host or "").strip()
        if not h or h in seen:
            continue
        seen.add(h)
        nodes.append(MeshGraphNode(peer_id=h, hop_distance=1))
        a, b = (local, h) if local <= h else (h, local)
        edges.append(MeshGraphEdge(a=a, b=b))

    # Deterministic order: nodes by (hop, id); edges by (a, b). Mirrors the
    # Rust assembler so the two surfaces are visually consistent.
    nodes.sort(key=lambda n: (n.hop_distance if n.hop_distance is not None else 1 << 30, n.peer_id))
    edges.sort(key=lambda e: (e.a, e.b))
    return nodes, edges


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/topology", response_model=MeshTopologyResponse)
async def get_mesh_topology() -> MeshTopologyResponse:
    """Return the mesh topology this docker node observes, plus its hub role.

    Prefers a fresh headless-Rust ``mesh_snapshot.json`` (real libp2p
    N-hop topology) when present; otherwise assembles the
    federation-derived graph (this hub at the center, its federated
    homeservers at hop 1). Always returns at least the local host node, so
    the map renders the "big brother" hub even before any peer appears.
    """
    hub_enabled = _hub_enabled()
    backup_count = _backup_blob_count()

    # 1. Prefer a real libp2p snapshot from a headless servitude.
    rust = _load_rust_snapshot()
    if rust is not None:
        nodes, edges = rust
        return MeshTopologyResponse(
            nodes=nodes,
            edges=edges,
            hub_enabled=hub_enabled,
            relay=hub_enabled,
            backup_blob_count=backup_count,
            source="rust_snapshot",
        )

    # 2. Federation-derived view — the docker node's real neighbors.
    # ``read_federation`` is blocking I/O (file lock + TOML parse); offload
    # it like ``explore.py`` does so it doesn't stall the event loop.
    loop = asyncio.get_event_loop()
    try:
        settings = await loop.run_in_executor(None, read_federation)
        hostnames = decode_server_name_patterns(settings.allowed_remote_server_names)
    except Exception as exc:  # pragma: no cover - defensive
        # A missing/unreadable tuwunel.toml must not break the map — render
        # the lone host node. Surface the reason in logs.
        logger.warning("mesh: federation read failed, host-only graph: %s", exc)
        hostnames = []

    nodes, edges = build_federation_graph(MATRIX_SERVER_NAME, hostnames)
    return MeshTopologyResponse(
        nodes=nodes,
        edges=edges,
        hub_enabled=hub_enabled,
        relay=hub_enabled,
        backup_blob_count=backup_count,
        source="federation",
    )
