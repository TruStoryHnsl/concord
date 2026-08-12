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

Two tiers of visibility (Spec B P3, tunneled-spring gate):

  * The **skeleton** — this pillar + its federated neighbors + hub role
    flags — is served unauthenticated (like ``/.well-known``): it reveals
    only the instance's own public-facing federation posture — its server
    name and the allowlist it already advertises via well-known discovery
    — plus boolean role flags and an opaque backup *count*. No user data,
    no private keys, no blob identities, no ciphertext. The map's hollow
    pre-login start page renders from this tier.
  * The **live web-threaded peer set** (``mesh_presence`` rows) is the
    sensitive part — *who is connected to this pillar right now*. It is
    only folded into the topology for a caller authenticated with this
    pillar (a valid Matrix session on this homeserver — the auth pathway
    Spec B routes native connections through). Anonymous callers never
    see it; a presented-but-invalid token is a 401, not a silent
    downgrade. Fail-closed.

``POST /api/mesh/presence`` is Matrix-auth'd per Spec B ("Presence intake
endpoint (NEW) — POST /api/mesh/presence (Matrix-auth'd)"): the payload's
Ed25519 persona signature proves *key possession*, and the Bearer token
proves the publisher actually *connected via the auth pathway* — without
it any independent signer on the internet could inject presence rows
(empirically proven against a live pillar, see
``.orrch/events/20260804T032704-c60373.md``).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import DATA_DIR, MATRIX_SERVER_NAME
from database import get_db
from dependencies import get_optional_user_id, get_user_id
from models import MeshPresence, PersonaBinding
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

# Hard ceiling on a presence record's requested ttl (seconds). A native
# instance asks for a ttl; we clamp it so a malicious/buggy peer can't pin
# a stale row on the pillar indefinitely. Spec E will tune the cadence;
# 300s (5 min) is a safe upper bound that survives a few missed refreshes.
MESH_PRESENCE_MAX_TTL_SECS = 300

# Minimum ttl — a presence record must live at least this long, so a peer
# can't request a 0s ttl that would be evicted before it's ever served.
MESH_PRESENCE_MIN_TTL_SECS = 1

# Raw Ed25519 public keys are exactly 32 bytes; signatures are 64. We
# reject anything else at intake (cheap structural guard before crypto).
ED25519_PUBKEY_LEN = 32
ED25519_SIG_LEN = 64


# ---------------------------------------------------------------------------
# Wire models — MUST match the client ``MeshGraph`` type
# (client/src/api/meshGraph.ts). snake_case on the wire; the client maps
# ``peer_id`` -> ``peerId`` and ``hop_distance`` -> ``hopDistance``.
# ---------------------------------------------------------------------------

class MeshGraphNode(BaseModel):
    """One node in the assembled mesh graph (wire shape).

    ``via`` / ``kind`` are OPTIONAL and only set for web-threaded peers a
    native instance reported to this pillar (Spec B): ``via="pillar"`` +
    ``kind="web_threaded"``. They are omitted (``None`` → dropped from the
    wire) for the pillar itself and for federated neighbors, so existing
    clients that don't know the fields keep working unchanged.
    """

    peer_id: str = Field(..., description="Stable node id (base58 PeerId on "
                         "native; Matrix server_name on the web/docker bridge).")
    hop_distance: int | None = Field(
        ...,
        description="BFS hop distance from the local node: 0 = this node, "
                    "1 = direct neighbor, null = unreachable island.",
    )
    via: str | None = Field(
        default=None,
        description="How this node is reached. 'pillar' for a web-threaded "
                    "peer the docker pillar relays. Omitted for the pillar "
                    "itself and federated neighbors.",
    )
    kind: str | None = Field(
        default=None,
        description="Node kind. 'web_threaded' for a p2p peer reported to "
                    "the pillar via /api/mesh/presence. Omitted otherwise.",
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


class MeshPresenceRequest(BaseModel):
    """Signed presence record a native (p2p) instance pushes to this pillar.

    ``persona_pubkey`` and ``sig`` are hex-encoded on the wire (raw bytes
    don't survive JSON). The pillar verifies ``sig`` is a valid Ed25519
    signature, made by ``persona_pubkey``, over the canonical message of
    ``(persona_id, persona_pubkey, adjacency, ttl)`` — see
    ``_presence_canonical_message``.
    """

    persona_id: str = Field(..., min_length=1, max_length=256)
    persona_pubkey: str = Field(..., description="hex-encoded 32-byte Ed25519 public key")
    sig: str = Field(..., description="hex-encoded 64-byte Ed25519 signature")
    # Bounded: the Rust publisher already sorts/dedupes/caps its adjacency
    # list; the server must not accept unbounded lists from arbitrary
    # authenticated callers (they are JSON-serialized into a TEXT column).
    adjacency: list[str] = Field(default_factory=list, max_length=64)

    @field_validator("adjacency")
    @classmethod
    def _bounded_peer_ids(cls, v: list[str]) -> list[str]:
        for entry in v:
            if len(entry) > 128:
                raise ValueError("adjacency entries must be <= 128 chars")
        return v
    ttl: int = Field(..., description="requested TTL in seconds (clamped server-side)")


class MeshPresenceResponse(BaseModel):
    """Result of accepting a presence record."""

    ok: bool
    persona_id: str
    expires_at: str = Field(..., description="RFC3339 UTC instant the record expires")
    ttl: int = Field(..., description="effective (clamped) TTL in seconds")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _presence_canonical_message(
    persona_id: str, persona_pubkey: bytes, adjacency: list[str], ttl: int
) -> bytes:
    """Build the canonical byte string the persona signature covers.

    Stable, unambiguous framing so the native signer and this verifier
    agree byte-for-byte. Fields are length-independent because we join the
    adjacency with a separator that cannot appear inside a peer id on the
    wire (newline). The pubkey is included as hex so the message is the
    same regardless of how the caller framed it.

    Format (UTF-8):
        ``concord-mesh-presence/v1\n<persona_id>\n<pubkey_hex>\n<adj>\n<ttl>``
    where ``<adj>`` is the adjacency entries joined by ``,``.
    """
    adj = ",".join(adjacency)
    msg = (
        "concord-mesh-presence/v1\n"
        f"{persona_id}\n"
        f"{persona_pubkey.hex()}\n"
        f"{adj}\n"
        f"{ttl}"
    )
    return msg.encode("utf-8")

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


def merge_presence_nodes(
    local_server_name: str,
    nodes: list[MeshGraphNode],
    edges: list[MeshGraphEdge],
    presence_rows: list[MeshPresence],
) -> tuple[list[MeshGraphNode], list[MeshGraphEdge]]:
    """Fold web-threaded presence peers into an existing graph (pure).

    Each non-expired presence row becomes a hop-1 node tagged
    ``via="pillar"`` / ``kind="web_threaded"``, with an undirected edge
    from the local pillar node. A presence peer whose ``persona_id``
    collides with a node already in the graph (the pillar itself, a
    federated neighbor, or a rust-snapshot peer) is skipped — those
    nodes are authoritative and must not be relabeled.

    ``local`` anchors the new edges; it is whatever the caller used as the
    hop-0 center so the edge endpoints line up with the rest of the graph.

    Visibility gating (Spec B P3 / tunneled-spring) happens in the
    caller: ``get_mesh_topology`` only passes ``presence_rows`` for a
    viewer authenticated with this pillar; anonymous viewers get an empty
    list here and therefore only the pillar + federation skeleton.
    """
    local = (local_server_name or "localhost").strip() or "localhost"
    existing = {n.peer_id for n in nodes}
    out_nodes = list(nodes)
    out_edges = list(edges)

    seen: set[str] = set()
    for row in presence_rows:
        pid = (row.persona_id or "").strip()
        if not pid or pid in existing or pid in seen:
            continue
        seen.add(pid)
        out_nodes.append(
            MeshGraphNode(
                peer_id=pid,
                hop_distance=1,
                via="pillar",
                kind="web_threaded",
            )
        )
        a, b = (local, pid) if local <= pid else (pid, local)
        out_edges.append(MeshGraphEdge(a=a, b=b))

    out_nodes.sort(
        key=lambda n: (n.hop_distance if n.hop_distance is not None else 1 << 30, n.peer_id)
    )
    out_edges.sort(key=lambda e: (e.a, e.b))
    return out_nodes, out_edges


async def _load_active_presence(
    db: AsyncSession, viewer_user_id: str
) -> list[MeshPresence]:
    """Return the viewer's OWN non-expired ``mesh_presence`` rows.

    Mesh/p2p data is user-scoped: the pillar folds in only presence rows
    published by the viewing account (``owner_user_id``), never the whole
    instance-wide live peer set. Rows with a NULL owner (published before
    the column existed) are visible to nobody — fail-closed; they are
    TTL'd so the NULL population self-clears.

    A row is active iff ``expires_at`` is still in the future. Expired rows
    are excluded here (and the background sweep deletes them), so the live
    peer set the map renders only reflects peers that refreshed within
    their TTL. A DB error degrades to an empty list — a presence-store
    failure must never break the (federation-correct) base topology.
    """
    now = datetime.now(timezone.utc)
    try:
        result = await db.execute(
            select(MeshPresence).where(
                MeshPresence.expires_at > now,
                MeshPresence.owner_user_id == viewer_user_id,
            )
        )
        return list(result.scalars().all())
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("mesh: presence read failed, base graph only: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

def _local_node_id(nodes: list[MeshGraphNode]) -> str:
    """The hop-0 node's id, or MATRIX_SERVER_NAME if there isn't one.

    Presence peers anchor their pillar edge to this id, so it must match
    whatever the base graph used as its center (the rust-snapshot self
    node, or the federation local server name)."""
    for n in nodes:
        if n.hop_distance == 0:
            return n.peer_id
    return (MATRIX_SERVER_NAME or "localhost").strip() or "localhost"


@router.get(
    "/topology",
    response_model=MeshTopologyResponse,
    # Drop None ``via``/``kind`` from nodes so the wire shape for the
    # pillar + federated/rust nodes stays byte-identical to the pre-Spec-B
    # contract ({peer_id, hop_distance}); web-threaded peers carry the two
    # extra keys.
    response_model_exclude_none=True,
)
async def get_mesh_topology(
    db: AsyncSession = Depends(get_db),
    viewer_user_id: str | None = Depends(get_optional_user_id),
) -> MeshTopologyResponse:
    """Return the mesh topology this docker node observes, plus its hub role.

    Prefers a fresh headless-Rust ``mesh_snapshot.json`` (real libp2p
    N-hop topology) when present; otherwise assembles the
    federation-derived graph (this hub at the center, its federated
    homeservers at hop 1). Always returns at least the local host node,
    so the map renders the "big brother" hub even before any peer appears.

    Tunneled-spring gate (Spec B P3) + user scoping: the web-threaded
    peers folded in as hop-1 ``via="pillar"`` nodes are ONLY the
    non-expired ``mesh_presence`` rows the *viewing account itself*
    published (``owner_user_id``). An anonymous viewer gets the skeleton
    alone; an authenticated viewer gets their own p2p/mesh data, never
    another account's. A caller presenting an invalid token gets 401
    from ``get_optional_user_id`` (fail-closed), never a silent
    anonymous downgrade.
    """
    hub_enabled = _hub_enabled()
    backup_count = _backup_blob_count()

    # Fail-closed default: no presence peers. An authenticated caller
    # sees ONLY the presence rows their own account published — the
    # live peer set is user-scoped, never instance-wide.
    presence_rows: list[MeshPresence] = []
    if viewer_user_id is not None:
        presence_rows = await _load_active_presence(db, viewer_user_id)

    # 1. Prefer a real libp2p snapshot from a headless servitude.
    rust = _load_rust_snapshot()
    if rust is not None:
        nodes, edges = rust
        nodes, edges = merge_presence_nodes(
            _local_node_id(nodes), nodes, edges, presence_rows
        )
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
    nodes, edges = merge_presence_nodes(
        _local_node_id(nodes), nodes, edges, presence_rows
    )
    return MeshTopologyResponse(
        nodes=nodes,
        edges=edges,
        hub_enabled=hub_enabled,
        relay=hub_enabled,
        backup_blob_count=backup_count,
        source="federation",
    )


@router.post(
    "/presence",
    response_model=MeshPresenceResponse,
    status_code=200,
)
async def post_mesh_presence(
    req: MeshPresenceRequest,
    db: AsyncSession = Depends(get_db),
    publisher_user_id: str = Depends(get_user_id),
) -> MeshPresenceResponse:
    """Accept a signed presence record from a connected p2p-capable instance.

    Spec B: the docker build is a PILLAR. Native instances that connect to
    it publish their presence/adjacency here; the pillar stores them
    (TTL'd) and re-serves them through ``/api/mesh/topology`` as
    web-threaded hop-1 peers. The pillar never speaks libp2p/WireGuard —
    this is the only way p2p peers appear on its map.

    **Matrix-auth'd** (Spec B P1, verbatim: "Presence intake endpoint
    (NEW) — POST /api/mesh/presence (Matrix-auth'd)"). The caller must
    hold a valid Matrix session on this pillar (Bearer token → whoami),
    i.e. actually be "a connected p2p-capable instance" per the auth
    pathway — the Ed25519 payload signature alone only proves key
    possession, which any independent signer on the internet has. No
    token / bad token → 401, nothing stored.

    Authenticity of the *record* = an Ed25519 signature over the canonical
    message of ``(persona_id, persona_pubkey, adjacency, ttl)``, verified
    against the supplied 32-byte public key. Bad signature / malformed key
    / bad hex → 400 (fail-closed). The requested ttl is clamped to
    ``[MESH_PRESENCE_MIN_TTL_SECS, MESH_PRESENCE_MAX_TTL_SECS]`` so a peer
    can't pin a stale row. Re-publishing upserts the persona's single row.
    """
    # Decode hex fields. Malformed hex is a client error, not a crash.
    try:
        pubkey_bytes = bytes.fromhex(req.persona_pubkey)
        sig_bytes = bytes.fromhex(req.sig)
    except ValueError:
        raise HTTPException(400, "persona_pubkey and sig must be valid hex")

    # Structural guards before doing crypto: an Ed25519 pubkey is exactly
    # 32 bytes, a signature exactly 64. Reject anything else cheaply.
    if len(pubkey_bytes) != ED25519_PUBKEY_LEN:
        raise HTTPException(400, "persona_pubkey must be 32 bytes (Ed25519)")
    if len(sig_bytes) != ED25519_SIG_LEN:
        raise HTTPException(400, "sig must be 64 bytes (Ed25519)")

    # Clamp the ttl to the allowed window.
    ttl = max(MESH_PRESENCE_MIN_TTL_SECS, min(int(req.ttl), MESH_PRESENCE_MAX_TTL_SECS))

    # Verify the signature over the canonical message.
    message = _presence_canonical_message(
        req.persona_id, pubkey_bytes, req.adjacency, req.ttl
    )
    try:
        Ed25519PublicKey.from_public_bytes(pubkey_bytes).verify(sig_bytes, message)
    except InvalidSignature:
        raise HTTPException(400, "presence signature verification failed")
    except Exception:
        # A malformed key that slipped the length check, or any other
        # crypto-layer rejection. Treat as a bad request, fail-closed.
        raise HTTPException(400, "presence signature could not be verified")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl)
    adjacency_json = json.dumps(req.adjacency)
    via_pillar = (MATRIX_SERVER_NAME or "localhost").strip() or "localhost"

    # Persona↔account binding: a persona belongs to exactly ONE account on
    # this instance (trust-on-first-use at the account level — the same
    # posture as the pubkey TOFU below, one layer up). First authenticated
    # publisher claims the persona; a later publish from a different
    # account is rejected even with a valid signature. This is what makes
    # mesh data user-scopable at read time.
    binding = (
        await db.execute(
            select(PersonaBinding).where(PersonaBinding.persona_id == req.persona_id)
        )
    ).scalar_one_or_none()
    if binding is not None:
        if binding.user_id != publisher_user_id:
            raise HTTPException(403, "persona is bound to a different account")
        if binding.persona_pubkey is None:
            binding.persona_pubkey = pubkey_bytes
    else:
        db.add(
            PersonaBinding(
                user_id=publisher_user_id,
                persona_id=req.persona_id,
                persona_pubkey=pubkey_bytes,
            )
        )

    # Upsert: one live row per persona. Re-publishing refreshes the TTL.
    existing = (
        await db.execute(
            select(MeshPresence).where(MeshPresence.persona_id == req.persona_id)
        )
    ).scalar_one_or_none()

    if existing is not None:
        # Persona-hijack guard: a persona_id is owned by the FIRST key that
        # claimed it (trust-on-first-use). A later publish carrying a valid
        # signature but a DIFFERENT pubkey is an attacker trying to overwrite
        # someone else's presence row (they signed a victim's persona_id with
        # their own key — the signature verifies against THAT key, so the
        # earlier check alone wouldn't catch it). Reject so the established
        # owner's record can't be hijacked.
        #
        # TODO(mesh-pillar P3): the stronger fix is to bind persona_id to the
        # key cryptographically — require persona_id == libp2p PeerId(pubkey)
        # (the Rust side already derives it that way via
        # persona_peer_id_from_pubkey); needs a vetted libp2p PeerId
        # derivation in Python. (The authenticated-session requirement
        # formerly deferred here is DONE — get_user_id gates this route.)
        if existing.persona_pubkey != pubkey_bytes:
            raise HTTPException(409, "persona is owned by a different key")
        existing.persona_pubkey = pubkey_bytes
        existing.sig = sig_bytes
        existing.adjacency = adjacency_json
        existing.ttl = ttl
        existing.expires_at = expires_at
        existing.posted_at = now
        existing.via_pillar = via_pillar
        existing.owner_user_id = publisher_user_id
    else:
        db.add(
            MeshPresence(
                persona_id=req.persona_id,
                persona_pubkey=pubkey_bytes,
                sig=sig_bytes,
                adjacency=adjacency_json,
                ttl=ttl,
                expires_at=expires_at,
                posted_at=now,
                via_pillar=via_pillar,
                owner_user_id=publisher_user_id,
            )
        )
    await db.commit()

    return MeshPresenceResponse(
        ok=True,
        persona_id=req.persona_id,
        expires_at=expires_at.isoformat(),
        ttl=ttl,
    )


async def evict_expired_presence() -> int:
    """Delete all expired ``mesh_presence`` rows. Returns the count removed.

    Called on a 60s cadence from the app lifespan (see
    ``server/main.py``). Eviction keeps the live peer set honest even
    between topology reads (which already filter on ``expires_at``) and
    bounds table growth. Best-effort: a failure is logged and swallowed so
    the sweep loop survives a transient DB hiccup.
    """
    from database import async_session

    now = datetime.now(timezone.utc)
    async with async_session() as db:
        result = await db.execute(
            delete(MeshPresence).where(MeshPresence.expires_at <= now)
        )
        await db.commit()
        return result.rowcount or 0
