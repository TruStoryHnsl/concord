"""Reticulum pillar node — the docker instance as mesh infrastructure.

The native (Rust/Tauri) build runs Reticulum as a *client* node: rnsd
with ``enable_transport = False``, loopback-only interfaces, announces
gated behind the persona visibility filter. The docker instance is the
always-on, stationary half of the ecosystem — this module makes it a
true **infra pillar**:

- an in-process RNS stack (``RNS.Reticulum``) with **transport enabled**,
  so the instance routes announces/paths/links for the mesh around it;
- a **TCP entrypoint** (``TCPServerInterface``) other nodes dial into —
  the docker instance is how a Concord user's devices reach Reticulum
  without running their own always-on transport node;
- a **pillar mailbox destination** (``concord.pillar.mailbox``) that
  accepts store-and-forward deposits over Reticulum links and feeds them
  into the same ``pending_messages`` relay the HTTP API serves;
- Concord-wire-compatible **text send** (``RelayFrame`` v1 over a raw
  ``RNS.Link`` packet to ``concord.persona.<persona_id>`` — byte-for-byte
  the format the engine validated live against rns 1.4.2).

Entrypoint modes (``reticulum.json``, admin-configured):

- ``off``      — no RNS stack at all (default; zero new surface).
- ``private``  — transport + entrypoint run, but the routing descriptor
  (domain:port) is NEVER published. It is served only by
  ``GET /api/reticulum/entrypoint`` to authenticated accounts that have
  at least one persona binding — i.e. validated concord-native users of
  this instance. The domain is the secret; distribution is limited to
  exactly the users the operator admitted.
- ``public``   — same runtime posture, and the descriptor is additionally
  advertised in ``/.well-known/concord/client`` for anyone to use.

Superuser invariant (docs/architecture/owner-scoped-trust.md): the
pillar NEVER announces or mints destinations on behalf of a user
persona, and nothing superuser-derived exists here at all — the only
identity this node announces is its own pillar identity.

RNS cannot be cleanly torn down and re-initialized inside one process,
so transport/interface changes made while the node is running report
``restart_required``; announce-interval and descriptor changes hot-apply.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
import queue
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Wire constants — MUST stay in lockstep with the Rust engine
# (src-tauri/crates/concord-engine/src/servitude/transport/reticulum.rs)
# and resources/reticulum/concord_link_bridge.py.
# ---------------------------------------------------------------------------

RETICULUM_APP_NAME = "concord"
RETICULUM_PERSONA_ASPECT = "persona"
PILLAR_ASPECTS = ("pillar", "mailbox")

RELAY_FRAME_VERSION = 1
MAX_RELAY_TEXT_BYTES = 4096

# Pillar mailbox envelope (deposits arriving over Reticulum). Versioned
# independently of RelayFrame; unknown versions are rejected.
MAILBOX_ENVELOPE_VERSION = 1
MAX_MAILBOX_ENVELOPE_BYTES = 8192

CONFIG_FILENAME = "reticulum.json"
PILLAR_IDENTITY_FILENAME = "pillar_identity"

MODES = ("off", "private", "public")


# ---------------------------------------------------------------------------
# Pure destination-hash derivation (validated against the engine's
# known-answer vectors in reticulum.rs — see tests).
# ---------------------------------------------------------------------------

def rns_identity_hash(x25519_pub: bytes, ed25519_pub: bytes) -> bytes:
    """RNS identity hash: SHA256(x25519_pub || ed25519_pub)[:16]."""
    return hashlib.sha256(x25519_pub + ed25519_pub).digest()[:16]


def rns_destination_hash(identity_hash: bytes, *name_parts: str) -> bytes:
    """RNS destination hash for ``".".join(name_parts)`` + identity."""
    full_name = ".".join(name_parts)
    name_hash = hashlib.sha256(full_name.encode("utf-8")).digest()[:10]
    return hashlib.sha256(name_hash + identity_hash).digest()[:16]


def persona_destination_hash(
    x25519_pub: bytes, ed25519_pub: bytes, persona_id: str
) -> str:
    """Hex destination hash for ``concord.persona.<persona_id>``."""
    ih = rns_identity_hash(x25519_pub, ed25519_pub)
    return rns_destination_hash(
        ih, RETICULUM_APP_NAME, RETICULUM_PERSONA_ASPECT, persona_id
    ).hex()


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class ReticulumNodeConfig:
    mode: str = "off"                      # off | private | public
    listen_host: str = "0.0.0.0"
    listen_port: int = 4242
    # The routing domain other nodes dial (the TCP entrypoint's public
    # name). In private mode this value is the SECRET — it is served only
    # to validated users, never published. The operator points it at
    # whatever DNS name reaches this container's listen_port.
    entry_domain: str | None = None
    announce_interval_secs: int = 300
    display_name: str = "Concord Pillar"

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.mode not in MODES:
            errors.append(f"mode must be one of {MODES}")
        if not (1 <= int(self.listen_port) <= 65535):
            errors.append("listen_port must be 1-65535")
        if self.announce_interval_secs < 30:
            errors.append("announce_interval_secs must be >= 30")
        if self.mode == "public" and not (self.entry_domain or "").strip():
            errors.append("public mode requires entry_domain")
        return errors


def _config_dir() -> Path:
    """The RNS config/storage dir. Lazy so tests can monkeypatch env."""
    raw = os.getenv("RETICULUM_CONFIG_DIR") or os.getenv("RNS_CONFIG_DIR")
    if raw:
        return Path(raw)
    from config import DATA_DIR

    return Path(DATA_DIR) / "reticulum"


def _config_file() -> Path:
    from config import DATA_DIR

    return Path(DATA_DIR) / CONFIG_FILENAME


def load_config() -> ReticulumNodeConfig:
    path = _config_file()
    if not path.exists():
        return ReticulumNodeConfig()
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        logger.warning("reticulum: unreadable %s — using defaults", path)
        return ReticulumNodeConfig()
    cfg = ReticulumNodeConfig()
    for key in asdict(cfg):
        if key in data:
            setattr(cfg, key, data[key])
    return cfg


def save_config(cfg: ReticulumNodeConfig) -> None:
    path = _config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    payload = json.dumps(asdict(cfg), indent=2)
    with open(tmp, "w") as fh:
        fh.write(payload)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def build_rns_config(cfg: ReticulumNodeConfig) -> str:
    """The rnsd-style config for the PILLAR posture.

    Divergence from the engine's client config is deliberate and exactly
    two lines: ``enable_transport = True`` (this node routes for the
    mesh) and a wide-bound ``TCPServerInterface`` (the entrypoint).
    """
    return f"""# Generated by Concord (server/services/reticulum_node.py).
# PILLAR posture: transport node + TCP entrypoint. Managed file — edits
# are overwritten when the admin config is applied.

[reticulum]
enable_transport = True
share_instance = Yes
shared_instance_type = tcp
shared_instance_port = 37428
instance_control_port = 37429
panic_on_interface_error = No

[logging]
loglevel = 3

[interfaces]

  [[Concord Pillar Entrypoint]]
    type = TCPServerInterface
    enabled = True
    listen_ip = {cfg.listen_host}
    listen_port = {cfg.listen_port}
"""


def write_rns_config(cfg: ReticulumNodeConfig) -> Path:
    d = _config_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = d / "config"
    path.write_text(build_rns_config(cfg))
    return path


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

@dataclass
class InboundDeposit:
    """A store-and-forward deposit that arrived over Reticulum."""

    to_persona: str
    payload_b64: str
    wire_id: str | None
    sender_identity_hash: str | None
    received_at: float = field(default_factory=time.time)


class _CatchAllAnnounceHandler:
    """RNS announce sink — records EVERY announce the transport hears.

    ``aspect_filter = None`` receives all aspects (crosstalk pattern);
    the runtime keeps a bounded table for the mesh endpoint.
    """

    def __init__(self, runtime: "ReticulumNodeRuntime") -> None:
        self.aspect_filter = None
        self._runtime = runtime

    def received_announce(self, destination_hash, announced_identity, app_data):  # noqa: ANN001
        try:
            self._runtime._record_announce(destination_hash, app_data)
        except Exception:  # noqa: BLE001 — introspection must never break RNS
            pass


class ReticulumNodeRuntime:
    """In-process RNS transport node + pillar mailbox.

    All RNS work happens on RNS's own threads; interaction points are
    thread-safe (`inbound` queue out, `send_text` runs the blocking link
    dance on a worker thread with a deadline).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._started = False
        self._soft_off = False
        self._start_error: str | None = None
        self._rns = None
        self._identity = None
        self._mailbox_dest = None
        self._announce_thread: threading.Thread | None = None
        self._announce_stop = threading.Event()
        self._links: dict[str, Any] = {}
        # Announce table — every announce this transport node hears, for
        # the mesh introspection endpoint (/api/reticulum/mesh). Bounded;
        # keyed by destination hash hex.
        self._announces: dict[str, dict] = {}
        self.config = ReticulumNodeConfig()
        # Deposits received over Reticulum, drained by an asyncio task in
        # the app lifespan into the pending_messages table.
        self.inbound: "queue.Queue[InboundDeposit]" = queue.Queue(maxsize=1024)

    # -- lifecycle ----------------------------------------------------------

    @staticmethod
    def rns_available() -> bool:
        try:
            import RNS  # noqa: F401

            return True
        except Exception:
            return False

    def start(self, cfg: ReticulumNodeConfig) -> bool:
        """Bring the node up. Returns True when running. Never raises —
        a reticulum failure must not take the API down."""
        with self._lock:
            self.config = cfg
            if cfg.mode == "off":
                self._soft_off = True
                return False
            if self._started:
                self._soft_off = False
                return True
            try:
                import RNS

                write_rns_config(cfg)
                self._rns = RNS.Reticulum(configdir=str(_config_dir()))

                identity_path = _config_dir() / PILLAR_IDENTITY_FILENAME
                if identity_path.exists():
                    self._identity = RNS.Identity.from_file(str(identity_path))
                if self._identity is None:
                    self._identity = RNS.Identity()
                    self._identity.to_file(str(identity_path))
                    try:
                        os.chmod(identity_path, 0o600)
                    except OSError:
                        pass

                self._mailbox_dest = RNS.Destination(
                    self._identity,
                    RNS.Destination.IN,
                    RNS.Destination.SINGLE,
                    RETICULUM_APP_NAME,
                    *PILLAR_ASPECTS,
                )
                self._mailbox_dest.set_proof_strategy(RNS.Destination.PROVE_ALL)
                self._mailbox_dest.set_packet_callback(self._on_mailbox_packet)
                self._mailbox_dest.set_link_established_callback(self._on_link)

                # Mesh introspection: hear every announce on the transport.
                try:
                    RNS.Transport.register_announce_handler(
                        _CatchAllAnnounceHandler(self)
                    )
                except Exception:  # noqa: BLE001
                    logger.debug("announce handler registration failed", exc_info=True)

                self._announce_stop.clear()
                self._announce_thread = threading.Thread(
                    target=self._announce_loop, name="reticulum-announce", daemon=True
                )
                self._announce_thread.start()

                self._started = True
                self._soft_off = False
                self._start_error = None
                logger.info(
                    "reticulum pillar up: mode=%s dest=%s identity=%s port=%d",
                    cfg.mode,
                    self.mailbox_destination_hash(),
                    self.identity_hash(),
                    cfg.listen_port,
                )
                return True
            except Exception as exc:  # noqa: BLE001 — availability > purity
                self._start_error = f"{type(exc).__name__}: {exc}"
                logger.warning("reticulum pillar failed to start: %s", self._start_error)
                return False

    def soft_stop(self) -> None:
        """Stop announcing + ignore inbound. RNS itself cannot be torn
        down in-process; a full stop needs a process restart."""
        with self._lock:
            self._soft_off = True
            self._announce_stop.set()

    def apply_config(self, cfg: ReticulumNodeConfig) -> dict:
        """Apply a new config as far as possible without a restart.

        Returns {"running": bool, "restart_required": bool}.
        """
        with self._lock:
            prev = self.config
            transport_changed = (
                prev.listen_host != cfg.listen_host
                or prev.listen_port != cfg.listen_port
            )
        write_rns_config(cfg)
        if cfg.mode == "off":
            self.soft_stop()
            with self._lock:
                self.config = cfg
            return {"running": False, "restart_required": self._started}
        if not self._started:
            running = self.start(cfg)
            return {"running": running, "restart_required": False}
        with self._lock:
            self.config = cfg
            self._soft_off = False
            self._announce_stop.set()  # wake loop to pick up new interval
            self._announce_stop.clear()
        return {"running": True, "restart_required": transport_changed}

    # -- identity/status ----------------------------------------------------

    def _record_announce(self, destination_hash, app_data) -> None:
        import time as _time

        dest = (
            destination_hash.hex()
            if isinstance(destination_hash, (bytes, bytearray))
            else str(destination_hash)
        )
        hops = None
        try:
            import RNS

            h = RNS.Transport.hops_to(
                bytes.fromhex(dest) if isinstance(dest, str) else destination_hash
            )
            # RNS uses a large sentinel for "no path"
            if isinstance(h, int) and 0 <= h < 128:
                hops = h
        except Exception:  # noqa: BLE001
            pass
        name = None
        if app_data:
            try:
                name = bytes(app_data)[:64].decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                name = None
        entry = {
            "dest": dest,
            "hops": hops,
            "name": name,
            "last_heard": _time.time(),
        }
        with self._lock:
            self._announces[dest] = entry
            if len(self._announces) > 2048:
                oldest = min(self._announces.values(), key=lambda e: e["last_heard"])
                self._announces.pop(oldest["dest"], None)

    def mesh_snapshot(self) -> dict:
        """Live mesh introspection for /api/reticulum/mesh — the pillar's
        own view of the reticulum network: identity, interfaces, and the
        announce table (destinations + hops)."""
        interfaces: list[dict] = []
        try:
            import RNS

            for iface in list(RNS.Transport.interfaces):
                try:
                    interfaces.append(
                        {
                            "name": str(iface),
                            "online": bool(getattr(iface, "online", False)),
                            "mode": getattr(iface, "mode", None),
                            "bitrate": getattr(iface, "bitrate", None),
                            "rxb": getattr(iface, "rxb", 0),
                            "txb": getattr(iface, "txb", 0),
                        }
                    )
                except Exception:  # noqa: BLE001
                    continue
        except Exception:  # noqa: BLE001
            pass
        with self._lock:
            announces = sorted(
                self._announces.values(), key=lambda e: -e["last_heard"]
            )[:512]
            started = self._started and not self._soft_off
        return {
            "running": started,
            "mode": self.config.mode,
            "identity": self.identity_hash(),
            "dest": self.mailbox_destination_hash(),
            "display_name": self.config.display_name,
            "listen_port": self.config.listen_port,
            "interfaces": interfaces,
            "announces": announces,
        }

    def identity_hash(self) -> str | None:
        if self._identity is None:
            return None
        return bytes(self._identity.hash).hex()

    def mailbox_destination_hash(self) -> str | None:
        if self._mailbox_dest is None:
            return None
        return bytes(self._mailbox_dest.hash).hex()

    def status(self) -> dict:
        return {
            "available": self.rns_available(),
            "running": self._started and not self._soft_off,
            "mode": self.config.mode,
            "identity_hash": self.identity_hash(),
            "mailbox_destination": self.mailbox_destination_hash(),
            "transport_enabled": self._started,
            "listen_port": self.config.listen_port,
            "announce_interval_secs": self.config.announce_interval_secs,
            "start_error": self._start_error,
        }

    # -- announce loop ------------------------------------------------------

    def _announce_loop(self) -> None:
        # First announce shortly after boot so the entrypoint becomes
        # discoverable fast, then on the configured cadence.
        self._announce_stop.wait(2.0)
        while not self._announce_stop.is_set():
            try:
                if self._mailbox_dest is not None and not self._soft_off:
                    self._mailbox_dest.announce(
                        app_data=self.config.display_name.encode("utf-8")[:64]
                    )
            except Exception as exc:  # noqa: BLE001
                logger.debug("reticulum announce failed: %s", exc)
            self._announce_stop.wait(max(30, self.config.announce_interval_secs))

    # -- mailbox intake -----------------------------------------------------

    def _on_link(self, link) -> None:  # type: ignore[no-untyped-def]
        try:
            link.set_packet_callback(self._on_mailbox_packet_link)
        except Exception:  # noqa: BLE001
            pass

    def _on_mailbox_packet(self, data: bytes, packet) -> None:  # type: ignore[no-untyped-def]
        self._ingest(data, packet)

    def _on_mailbox_packet_link(self, data: bytes, packet) -> None:  # type: ignore[no-untyped-def]
        self._ingest(data, packet)

    def _ingest(self, data: bytes, packet) -> None:  # type: ignore[no-untyped-def]
        """Parse a mailbox envelope and enqueue the deposit.

        Envelope (JSON, <= MAX_MAILBOX_ENVELOPE_BYTES):
          {"version":1,"kind":"deposit","to_persona":"<id>",
           "payload_b64":"<opaque frame bytes>","wire_id":"<sender id>"?}

        Anything else is dropped (logged at debug) — the pillar is not a
        generic packet sink.
        """
        if self._soft_off:
            return
        if len(data) > MAX_MAILBOX_ENVELOPE_BYTES:
            logger.debug("reticulum mailbox: oversize envelope dropped")
            return
        try:
            env = json.loads(data.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            logger.debug("reticulum mailbox: non-JSON packet dropped")
            return
        if env.get("version") != MAILBOX_ENVELOPE_VERSION or env.get("kind") != "deposit":
            logger.debug("reticulum mailbox: unknown envelope dropped")
            return
        to_persona = env.get("to_persona")
        payload_b64 = env.get("payload_b64")
        if not isinstance(to_persona, str) or not isinstance(payload_b64, str):
            return
        try:
            base64.b64decode(payload_b64, validate=True)
        except (binascii.Error, ValueError):
            return
        sender_hash: str | None = None
        try:
            link = getattr(packet, "link", None)
            if link is not None:
                remote = link.get_remote_identity()
                if remote is not None:
                    sender_hash = bytes(remote.hash).hex()
        except Exception:  # noqa: BLE001
            sender_hash = None
        wire_id = env.get("wire_id")
        deposit = InboundDeposit(
            to_persona=to_persona,
            payload_b64=payload_b64,
            wire_id=wire_id if isinstance(wire_id, str) else None,
            sender_identity_hash=sender_hash,
        )
        try:
            self.inbound.put_nowait(deposit)
        except queue.Full:
            logger.warning("reticulum mailbox: inbound queue full, deposit dropped")

    # -- outbound text (RelayFrame v1, engine-compatible) -------------------

    def send_text(
        self,
        dest_hash_hex: str,
        peer_persona_id: str,
        from_name: str,
        body: str,
        timeout_secs: float = 30.0,
    ) -> None:
        """Send a Concord ``RelayFrame`` v1 text frame to a persona
        destination. Blocking — callers run it in a thread executor.

        Raises RuntimeError with a human-readable reason on failure.
        """
        if not self._started or self._soft_off:
            raise RuntimeError("reticulum node is not running")
        body_bytes = body.encode("utf-8")
        if len(body_bytes) > MAX_RELAY_TEXT_BYTES:
            raise RuntimeError(f"text exceeds {MAX_RELAY_TEXT_BYTES} bytes")
        frame = json.dumps(
            {
                "version": RELAY_FRAME_VERSION,
                "body": {"kind": "text", "from": from_name, "body": body},
            }
        ).encode("utf-8")

        import RNS

        try:
            dest_hash = bytes.fromhex(dest_hash_hex)
        except ValueError:
            raise RuntimeError("destination hash must be hex")
        if len(dest_hash) != 16:
            raise RuntimeError("destination hash must be 16 bytes (32 hex chars)")

        deadline = time.monotonic() + timeout_secs
        if not RNS.Transport.has_path(dest_hash):
            RNS.Transport.request_path(dest_hash)
            while not RNS.Transport.has_path(dest_hash):
                if time.monotonic() > deadline:
                    raise RuntimeError("no path to destination (peer unreachable)")
                time.sleep(0.1)

        peer_identity = RNS.Identity.recall(dest_hash)
        if peer_identity is None:
            raise RuntimeError("destination identity unknown (no announce heard)")

        out_dest = RNS.Destination(
            peer_identity,
            RNS.Destination.OUT,
            RNS.Destination.SINGLE,
            RETICULUM_APP_NAME,
            RETICULUM_PERSONA_ASPECT,
            peer_persona_id,
        )
        if bytes(out_dest.hash) != dest_hash:
            raise RuntimeError(
                "destination hash does not match persona_id "
                "(wrong persona for this destination)"
            )

        link = self._links.get(dest_hash_hex)
        if link is None or getattr(link, "status", None) != RNS.Link.ACTIVE:
            link = RNS.Link(out_dest)
            while getattr(link, "status", None) != RNS.Link.ACTIVE:
                if time.monotonic() > deadline:
                    try:
                        link.teardown()
                    except Exception:  # noqa: BLE001
                        pass
                    raise RuntimeError("link establishment timed out")
                time.sleep(0.1)
            try:
                link.identify(self._identity)
            except Exception:  # noqa: BLE001
                pass
            self._links[dest_hash_hex] = link

        if len(frame) > RNS.Link.MDU:
            raise RuntimeError("frame exceeds link MDU")
        packet = RNS.Packet(link, frame)
        receipt = packet.send()
        if receipt is False:
            raise RuntimeError("packet send failed")


# Process-global runtime (single-worker deployment, same as every other
# in-process subsystem here).
runtime = ReticulumNodeRuntime()
