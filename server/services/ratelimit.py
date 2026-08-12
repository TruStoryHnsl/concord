"""Shared abuse-protection primitives: trusted-proxy-aware client IP,
bounded token buckets, failure lockouts, and the global rate-limit
middleware.

Why this module exists
======================

The 2026-08-12 protections audit found four independent hand-rolled
copies of a sliding-window limiter (registration, matrix login proxy,
disposable nodes, webhooks), every one of them keyed on a client IP
extracted by blindly trusting the first ``X-Forwarded-For`` /
``Cf-Connecting-Ip`` / ``X-Real-Ip`` header — client-controlled values,
so every per-IP limit was spoofable. There was also no global request
limiter at all, no TOTP lockout, and no negative caching in the auth
dependency (each bad Bearer token produced an outbound homeserver call).

This module centralizes:

- :func:`client_ip` — the ONE way to resolve a caller address. Forwarded
  headers are honored only when the direct peer is a trusted proxy
  (``CONCORD_TRUSTED_PROXIES``, defaulting to loopback + RFC1918 — the
  in-compose Caddy hop). Anything else uses the socket peer address, so
  header spoofing no longer defeats the limiters.
- :class:`BucketTable` — bounded LRU token-bucket table (429 + Retry-After
  material). Token buckets, not deques: O(1) memory per key.
- :class:`FailureLock` — sliding failure-count lockout (TOTP, recovery).
- :class:`RateLimitMiddleware` — a global per-IP budget with a stricter
  budget for sensitive unauthenticated paths (registration, auth
  recovery, invite validation, disposable nodes, relay deposits).

Tuning env vars (all optional):

- ``CONCORD_RATE_LIMIT_DISABLED=1``  — kill switch (used by the test
  suite's conftest; dedicated tests re-enable it explicitly).
- ``CONCORD_RATE_LIMIT_RPM``         — global per-IP budget (default 300/min).
- ``CONCORD_RATE_LIMIT_SENSITIVE_RPM`` — sensitive-path budget (default 20/min).
- ``CONCORD_TRUSTED_PROXIES``        — comma-separated CIDRs.

All state is in-process (single-worker deployment, same as every
existing limiter in this codebase). Buckets are capped at
``MAX_TRACKED_KEYS`` with LRU eviction so an address-rotation flood
cannot grow memory without bound.
"""
from __future__ import annotations

import ipaddress
import os
import threading
import time
from collections import OrderedDict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

MAX_TRACKED_KEYS = 4096

_DEFAULT_TRUSTED = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"


def _trusted_networks() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    raw = os.getenv("CONCORD_TRUSTED_PROXIES", _DEFAULT_TRUSTED)
    nets = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return nets


def _is_trusted_peer(addr: str | None) -> bool:
    if not addr:
        return False
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        # Non-IP peers (ASGI test transports report e.g. "testclient")
        # count as trusted local harnesses, not remote attackers.
        return True
    return any(ip in net for net in _trusted_networks())


def client_ip(request: Request) -> str:
    """Resolve the caller's address for rate-limit keying.

    Forwarded headers are honored only when the DIRECT peer is a trusted
    proxy — and even then, X-Forwarded-For is walked RIGHT to LEFT,
    skipping trusted-proxy hops: proxies APPEND the address they saw, so
    the rightmost untrusted entry is the real client, while leftmost
    entries are attacker-writable (a client can send its own
    X-Forwarded-For and Caddy appends to it). Taking the first entry —
    what the old per-router helpers did — let any caller choose its own
    bucket key straight through the edge.
    """
    peer = request.client.host if request.client else None
    if _is_trusted_peer(peer):
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            hops = [h.strip() for h in fwd.split(",") if h.strip()]
            for hop in reversed(hops):
                if not _is_trusted_peer(hop):
                    return hop
            if hops:
                return hops[0]
        # A trusted proxy that sets a single X-Real-Ip (rather than a
        # chain) — honored only because the direct peer is trusted.
        real = request.headers.get("x-real-ip")
        if real:
            return real.strip()
    return peer or "unknown"


class _Bucket:
    __slots__ = ("tokens", "updated")

    def __init__(self, tokens: float, updated: float) -> None:
        self.tokens = tokens
        self.updated = updated


class BucketTable:
    """Bounded LRU table of token buckets.

    ``check(key)`` refills by elapsed time and spends one token; returns
    the seconds to wait when the bucket is empty (0.0 == allowed).
    """

    def __init__(self, rate_per_min: float, burst: float | None = None) -> None:
        self.rate = rate_per_min / 60.0
        self.capacity = burst if burst is not None else max(rate_per_min, 1.0)
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()
        self._lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> float:
        now = now if now is not None else time.monotonic()
        with self._lock:
            bucket = self._buckets.pop(key, None)
            if bucket is None:
                bucket = _Bucket(self.capacity, now)
            else:
                bucket.tokens = min(
                    self.capacity, bucket.tokens + (now - bucket.updated) * self.rate
                )
                bucket.updated = now
            allowed = bucket.tokens >= 1.0
            retry_after = 0.0 if allowed else (1.0 - bucket.tokens) / self.rate
            if allowed:
                bucket.tokens -= 1.0
            self._buckets[key] = bucket
            while len(self._buckets) > MAX_TRACKED_KEYS:
                self._buckets.popitem(last=False)
            return retry_after

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


class FailureLock:
    """Sliding-window failure lockout (e.g. TOTP brute-force guard).

    ``locked(key)`` → remaining lockout seconds (0 == not locked).
    ``record_failure(key)`` → registers one failure; when ``max_failures``
    accumulate inside ``window_secs`` the key locks for ``lock_secs``.
    ``record_success(key)`` clears the key.
    """

    def __init__(self, max_failures: int, window_secs: float, lock_secs: float) -> None:
        self.max_failures = max_failures
        self.window = window_secs
        self.lock_secs = lock_secs
        self._failures: OrderedDict[str, list[float]] = OrderedDict()
        self._locked_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def locked(self, key: str, now: float | None = None) -> float:
        now = now if now is not None else time.monotonic()
        with self._lock:
            until = self._locked_until.get(key, 0.0)
            return max(0.0, until - now)

    def record_failure(self, key: str, now: float | None = None) -> float:
        now = now if now is not None else time.monotonic()
        with self._lock:
            history = self._failures.pop(key, [])
            history = [t for t in history if now - t < self.window]
            history.append(now)
            self._failures[key] = history
            while len(self._failures) > MAX_TRACKED_KEYS:
                evicted, _ = self._failures.popitem(last=False)
                self._locked_until.pop(evicted, None)
            if len(history) >= self.max_failures:
                self._locked_until[key] = now + self.lock_secs
                return self.lock_secs
            return 0.0

    def record_success(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()
            self._locked_until.clear()


def rate_limits_disabled() -> bool:
    return os.getenv("CONCORD_RATE_LIMIT_DISABLED", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


# Paths that unauthenticated attackers probe/flood; these get the tight
# budget. Matched by prefix against the request path.
SENSITIVE_PREFIXES = (
    "/api/register",
    "/api/auth/",
    "/api/invites/validate",
    "/api/nodes/disposable",
    "/api/relay/",
    "/api/reticulum/send",
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Global per-IP budget + tight budget for sensitive paths.

    Buckets are lazily (re)built so env-var changes in tests take effect
    per instantiation; the middleware itself is registered once in
    ``main.py``.
    """

    def __init__(self, app) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        global_rpm = float(os.getenv("CONCORD_RATE_LIMIT_RPM", "300"))
        sensitive_rpm = float(os.getenv("CONCORD_RATE_LIMIT_SENSITIVE_RPM", "20"))
        self.global_buckets = BucketTable(global_rpm, burst=global_rpm * 2)
        self.sensitive_buckets = BucketTable(sensitive_rpm, burst=sensitive_rpm)

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if rate_limits_disabled() or request.method == "OPTIONS":
            return await call_next(request)

        ip = client_ip(request)
        path = request.url.path

        retry = self.global_buckets.check(ip)
        if retry <= 0 and any(path.startswith(p) for p in SENSITIVE_PREFIXES):
            retry = self.sensitive_buckets.check(f"{ip}|sensitive")
        if retry > 0:
            return JSONResponse(
                {"detail": "Rate limit exceeded. Slow down."},
                status_code=429,
                headers={"Retry-After": str(max(1, int(retry + 0.999)))},
            )
        return await call_next(request)


# Shared instances for endpoint-level guards -------------------------------

# TOTP: 5 wrong codes in 5 minutes → 15-minute lockout per user.
totp_lock = FailureLock(max_failures=5, window_secs=300, lock_secs=900)

# Password recovery: 3 sends per hour per IP AND per username.
recovery_ip_buckets = BucketTable(rate_per_min=3 / 60, burst=3)
recovery_user_buckets = BucketTable(rate_per_min=3 / 60, burst=3)


def reset_all() -> None:
    """Test helper: clear every shared limiter."""
    totp_lock.reset()
    recovery_ip_buckets.reset()
    recovery_user_buckets.reset()
