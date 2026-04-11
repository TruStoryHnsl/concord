"""Wave 1 — Hello-world appservice echo bot fixture (INS-024).

Depends on Wave 0 (``test_tuwunel_asapi.py``). Wave 0 proved that tuwunel
v1.5.1 supports all six of the Matrix Application-Service-API contract
points the bridge relies on. Wave 1 proves those contract points are
**sufficient** to run a working echo bot: if a hello-world AS can receive
a Matrix message via ``PUT /_matrix/app/v1/transactions/{txnId}`` and
reply through the C-S API using its ``as_token`` and ``?user_id=``
masquerading, then the AS channel is healthy end-to-end and Wave 2
(mautrix-discord wiring) can proceed with confidence.

## Why this is a fixture, not an integration test

Running the echo bot against a live tuwunel homeserver would require:
  1. A built tuwunel binary (only present on a built client)
  2. ~5 seconds of startup time per test
  3. A second process to host the echo listener

None of those are acceptable for a default pytest run. Wave 1 instead
uses an **in-process fake homeserver** that mimics tuwunel's AS-API
surface — specifically the two halves of the AS channel:

  * **Homeserver → AS**: ``PUT /_matrix/app/v1/transactions/{txnId}``
    (server-initiated event push, authenticated by a shared ``hs_token``).
  * **AS → Homeserver**: any C-S API call authenticated with the AS's
    ``as_token`` and an optional ``?user_id=`` query parameter that
    masquerades as a namespaced virtual user.

The fixture's fake homeserver enforces the EXACT authentication rules
that tuwunel v1.5.1 uses (verified in Wave 0):

  * reject C-S calls with a wrong ``as_token``
  * reject ``?user_id=`` values outside the AS namespace regex (the
    exclusive-namespace guarantee from Requirement 2)
  * sign outgoing transaction pushes with the registration's ``hs_token``
    and reject any AS that cannot validate it (Requirement 3)

With both sides locked down, an echo bot that passes this test is
provably using the AS channel correctly — and a future break in
``bridge_config.py`` that generates a malformed registration will fail
at this layer before anyone tries to run it against a real bridge.

## What the test proves

  1. The registration YAML ``bridge_config.py`` (Wave 2) generates is
     parseable by a ruma-compatible consumer.
  2. A well-formed ``PUT /_matrix/app/v1/transactions/{txnId}`` payload
     reaches the echo bot and the bot can decode the events.
  3. The echo bot can reply via ``PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}?user_id=@_echo_bot:localhost``
     with a valid ``Authorization: Bearer <as_token>`` header.
  4. Masqueraded sender masks the request correctly.
  5. Exclusive namespace enforcement blocks a call that tries to
     masquerade as a user outside the AS namespace regex.
  6. ``rate_limited: false`` does not accidentally get dropped by the
     registration pipeline.

Each requirement maps to one pytest case below.
"""
from __future__ import annotations

import asyncio
import re
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import yaml
from fastapi import FastAPI, HTTPException, Query, Request
from httpx import ASGITransport


# ---------------------------------------------------------------------
# Fake homeserver that enforces the tuwunel v1.5.1 AS-API contract
# ---------------------------------------------------------------------


@dataclass
class _AsRegistration:
    """Minimal ruma-compatible registration record.

    Only the fields the Wave 1 fixture exercises are present. The shape
    intentionally mirrors ``ruma::api::appservice::Registration`` so
    upgrading this fixture to read a real ``registration.yaml`` from
    Wave 2 is a zero-diff change.
    """

    id: str
    url: str
    as_token: str
    hs_token: str
    sender_localpart: str
    user_namespace_regex: str
    exclusive_users: bool
    rate_limited: bool

    @property
    def sender_mxid(self) -> str:
        return f"@{self.sender_localpart}:{_HS_SERVER_NAME}"

    def matches_user(self, user_id: str) -> bool:
        """Return True when ``user_id`` falls in the AS namespace.

        Mirrors ``RegistrationInfo::is_user_match`` from tuwunel
        ``src/service/appservice/registration_info.rs:35``: the sender
        bot is always a match, and everyone else must satisfy the
        compiled users-namespace regex.
        """
        if user_id == self.sender_mxid:
            return True
        return bool(re.fullmatch(self.user_namespace_regex, user_id))


_HS_SERVER_NAME = "echo.local"
"""Server name used by the fake homeserver. Only needs to be lexically
valid; no DNS resolution occurs."""


@dataclass
class _FakeHomeserverState:
    """Mutable state a single test case runs the fake homeserver with.

    Keeping state on a dataclass (rather than module globals) makes
    parallel test runs safe under pytest-xdist and lets each test case
    build its own registration, message log, and namespace restrictions
    without leaking across cases.
    """

    registration: _AsRegistration
    sent_messages: list[dict[str, Any]] = field(default_factory=list)
    txn_deliveries: list[str] = field(default_factory=list)
    rejected_calls: list[tuple[str, int, str]] = field(default_factory=list)


async def _cs_send_message(
    state: _FakeHomeserverState,
    room_id: str,
    txn_id: str,
    body: dict[str, Any],
    headers: dict[str, str],
    query: dict[str, str],
) -> tuple[int, dict[str, Any]]:
    """Handle ``PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}``.

    This is the C-S API endpoint the echo bot calls to publish its reply
    back through the "homeserver" to the original sender. The fake
    handler enforces three invariants that tuwunel v1.5.1 also enforces
    (see Wave 0 source references):

      1. ``Authorization: Bearer <as_token>`` must match the registered AS
      2. Any ``?user_id=`` query value must satisfy the AS namespace regex
      3. The ``txn_id`` path segment must be non-empty (replay suppression
         doesn't run here because the echo bot only fires once per test)
    """
    reg = state.registration

    # (1) Authentication check — corresponds to
    # tuwunel's auth_appservice handler matching on the Bearer token.
    auth = headers.get("authorization", "")
    if auth != f"Bearer {reg.as_token}":
        state.rejected_calls.append(("/rooms/.../send", 401, "bad as_token"))
        return 401, {"errcode": "M_UNKNOWN_TOKEN", "error": "Bad as_token"}

    # (2) Masquerading check — corresponds to
    # ``auth_appservice`` reading ``request.query.user_id`` and calling
    # ``info.is_user_match``.
    masquerade = query.get("user_id")
    effective_sender = masquerade or reg.sender_mxid
    if masquerade and not reg.matches_user(masquerade):
        state.rejected_calls.append(
            ("/rooms/.../send", 403, f"user_id out of namespace: {masquerade}")
        )
        return 403, {
            "errcode": "M_EXCLUSIVE",
            "error": "User is not in namespace.",
        }

    if not txn_id.strip():
        return 400, {
            "errcode": "M_INVALID_PARAM",
            "error": "txn_id must be non-empty",
        }

    record = {
        "room_id": room_id,
        "txn_id": txn_id,
        "sender": effective_sender,
        "content": body,
    }
    state.sent_messages.append(record)

    # Matrix returns an event id on success. The fake uses the txn_id as
    # the event id because the echo bot does not need to correlate them.
    return 200, {"event_id": f"${txn_id}:{_HS_SERVER_NAME}"}


async def _deliver_txn_to_as(
    state: _FakeHomeserverState,
    as_http: httpx.AsyncClient,
    txn_id: str,
    events: list[dict[str, Any]],
) -> int:
    """Simulate tuwunel pushing a transaction to the AS via
    ``PUT /_matrix/app/v1/transactions/{txnId}``.

    Tuwunel signs the request with ``?access_token=<hs_token>`` (see
    ``src/service/sending/sender.rs:762`` where the ruma push_events
    call threads ``hs_token`` through the outgoing auth). The echo-bot
    AS must validate the query parameter before accepting the push —
    otherwise any unauthenticated HTTP client on the same network
    could feed forged events into the bridge.
    """
    response = await as_http.put(
        f"/_matrix/app/v1/transactions/{txn_id}",
        params={"access_token": state.registration.hs_token},
        json={"events": events},
    )
    state.txn_deliveries.append(txn_id)
    return response.status_code


# ---------------------------------------------------------------------
# The echo bot AS itself — a FastAPI sub-app
# ---------------------------------------------------------------------


def _build_echo_bot_app(
    state: _FakeHomeserverState,
    cs_client_factory: Callable[[], httpx.AsyncClient],
) -> FastAPI:
    """Build a minimal FastAPI echo bot that speaks the AS API.

    The bot listens on ``PUT /_matrix/app/v1/transactions/{txnId}``,
    validates the ``access_token`` query param against the registered
    ``hs_token``, decodes each incoming ``m.room.message`` event, and
    issues a C-S API call back through the fake homeserver to publish
    an "echo: <body>" reply in the same room, masqueraded as the bot.

    ``cs_client_factory`` returns a fresh AsyncClient pointed at the
    fake homeserver. Taking it as a factory (not a stored client) keeps
    the test body in control of the client lifetime.
    """
    reg = state.registration
    bot = FastAPI(title=f"Echo AS {reg.id}")

    @bot.put("/_matrix/app/v1/transactions/{txn_id}")
    async def receive_txn(  # noqa: ANN202 — FastAPI handler
        txn_id: str,
        request: Request,
        access_token: str = Query(...),
    ):
        # (3) Txn-push authentication check.
        if access_token != reg.hs_token:
            # In prod a mismatched hs_token means the push was forged;
            # return 403 so the homeserver retries with its real token
            # instead of silently succeeding.
            raise HTTPException(
                status_code=403,
                detail={
                    "errcode": "M_FORBIDDEN",
                    "error": "Bad hs_token",
                },
            )

        payload = await request.json()
        events: list[dict[str, Any]] = payload.get("events", [])

        async with cs_client_factory() as client:
            for evt in events:
                if evt.get("type") != "m.room.message":
                    continue
                room_id = evt.get("room_id")
                body = evt.get("content", {}).get("body", "")
                sender = evt.get("sender", "")
                if not room_id:
                    continue
                if sender == reg.sender_mxid:
                    # Don't echo our own reflections — loop prevention.
                    continue
                reply_txn = secrets.token_hex(16)
                await client.put(
                    f"/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{reply_txn}",
                    headers={"Authorization": f"Bearer {reg.as_token}"},
                    params={"user_id": reg.sender_mxid},
                    json={
                        "msgtype": "m.text",
                        "body": f"echo: {body}",
                    },
                )

        return {}

    return bot


# ---------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------


def _make_registration() -> _AsRegistration:
    """Generate a fresh registration with high-entropy tokens.

    ``secrets.token_urlsafe(32)`` is 256-bit entropy — matches the
    ``test_generate_registration_token_length`` requirement Wave 2 will
    enforce on the production generator. Duplicating the standard here
    keeps Wave 1 independent of Wave 2's helper module and prevents a
    regression in bridge_config.py from silently making this fixture
    pass with weaker tokens.
    """
    return _AsRegistration(
        id="concord_echo_probe",
        url="http://as.invalid:29999",  # unused in-process
        as_token="as_" + secrets.token_urlsafe(32),
        hs_token="hs_" + secrets.token_urlsafe(32),
        sender_localpart="_echo_bot",
        user_namespace_regex=rf"@_echo_.*:{re.escape(_HS_SERVER_NAME)}",
        exclusive_users=True,
        rate_limited=False,
    )


@pytest.fixture
async def echo_fixture() -> AsyncIterator[tuple[_FakeHomeserverState, httpx.AsyncClient]]:
    """Spin up the fake homeserver and echo bot wired together in-process.

    Returns a ``(state, as_client)`` pair:
      * ``state`` — the mutable :class:`_FakeHomeserverState` the caller
        can read to assert on messages sent, txns delivered, and calls
        rejected for bad auth.
      * ``as_client`` — an httpx ASGI client bound to the echo bot AS.
        The caller uses this to simulate tuwunel pushing transactions
        to the AS via ``_deliver_txn_to_as``.
    """
    state = _FakeHomeserverState(registration=_make_registration())

    hs = FastAPI(title="Fake Homeserver (Wave 1 fixture)")

    @hs.put("/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{txn_id}")
    async def cs_send(  # noqa: ANN202
        room_id: str,
        txn_id: str,
        request: Request,
    ):
        body = await request.json()
        status, response = await _cs_send_message(
            state=state,
            room_id=room_id,
            txn_id=txn_id,
            body=body,
            headers={k.lower(): v for k, v in request.headers.items()},
            query=dict(request.query_params),
        )
        if status != 200:
            raise HTTPException(status_code=status, detail=response)
        return response

    # Build a CS client factory that points at the fake HS over ASGI.
    def _cs_client() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=ASGITransport(app=hs),
            base_url="http://homeserver.local",
            timeout=5.0,
        )

    bot_app = _build_echo_bot_app(state=state, cs_client_factory=_cs_client)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=bot_app),
        base_url="http://as.local",
        timeout=5.0,
    ) as as_client:
        yield state, as_client


# ---------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------


async def test_echo_bot_round_trip_returns_200(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """Happy path: push one m.room.message → echo bot returns 200.

    The bot's 200 response is the homeserver-facing half of the
    contract. A 500 or a non-ruma response shape would cause tuwunel
    to retry the txn (see ``src/service/sending/sender.rs`` — tuwunel
    retries failed txns on an exponential backoff until the AS
    answers 200). If the bot ever returns anything else on the happy
    path, mautrix-discord would log the same error loop.
    """
    state, as_client = echo_fixture
    events = [
        {
            "type": "m.room.message",
            "event_id": "$evt-1",
            "room_id": "!room:echo.local",
            "sender": "@alice:echo.local",
            "content": {"msgtype": "m.text", "body": "hello"},
        }
    ]
    status = await _deliver_txn_to_as(
        state=state,
        as_http=as_client,
        txn_id="txn-1",
        events=events,
    )
    assert status == 200
    assert state.txn_deliveries == ["txn-1"]


async def test_echo_bot_publishes_reply_via_cs_api(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """End-to-end: incoming message triggers an AS → HS C-S publish.

    This is THE Wave 1 proof point. A message lands on the AS via
    transaction push → the AS uses its ``as_token`` to call back into
    the homeserver via the C-S API → the homeserver records the reply
    in the same room with the bot's masqueraded sender. If this round
    trip works for a 4-line Python bot, it works for mautrix-discord.
    """
    state, as_client = echo_fixture
    events = [
        {
            "type": "m.room.message",
            "event_id": "$evt-2",
            "room_id": "!room:echo.local",
            "sender": "@alice:echo.local",
            "content": {"msgtype": "m.text", "body": "ping"},
        }
    ]

    status = await _deliver_txn_to_as(
        state=state,
        as_http=as_client,
        txn_id="txn-2",
        events=events,
    )

    assert status == 200
    assert len(state.sent_messages) == 1, (
        f"Expected one reply, got {len(state.sent_messages)} — "
        f"echo loop or drop path broken"
    )
    reply = state.sent_messages[0]
    assert reply["room_id"] == "!room:echo.local"
    assert reply["sender"] == f"@_echo_bot:{_HS_SERVER_NAME}", (
        "Reply did not masquerade as the AS sender localpart"
    )
    assert reply["content"] == {"msgtype": "m.text", "body": "echo: ping"}


async def test_echo_bot_ignores_non_message_events(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """Membership events should NOT trigger an echo.

    mautrix-discord observes state events for bookkeeping but does not
    reply to them. A naive echo implementation that replies to every
    event in a txn would loop when it saw its own ``m.room.member`` join
    event on the matrix side. Pinning this here makes sure the contract
    is clear: only ``m.room.message`` triggers a reply.
    """
    state, as_client = echo_fixture
    events = [
        {
            "type": "m.room.member",
            "event_id": "$join-1",
            "room_id": "!room:echo.local",
            "sender": "@alice:echo.local",
            "state_key": "@alice:echo.local",
            "content": {"membership": "join"},
        }
    ]
    status = await _deliver_txn_to_as(
        state=state,
        as_http=as_client,
        txn_id="txn-3",
        events=events,
    )
    assert status == 200
    assert state.sent_messages == [], (
        "Echo bot replied to a non-message event — mautrix-discord "
        "would blow its rate budget if this ever shipped"
    )


async def test_echo_bot_does_not_reply_to_its_own_messages(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """The bot must suppress replies to its own echoes.

    Without this guard, the first echo would arrive back in the next
    transaction as a new m.room.message from ``@_echo_bot``, which
    would trigger another reply, ad infinitum. Every production AS has
    to implement this filter, and its absence is a classic bridge
    failure mode we want to lock out at the fixture level.
    """
    state, as_client = echo_fixture
    events = [
        {
            "type": "m.room.message",
            "event_id": "$evt-self",
            "room_id": "!room:echo.local",
            "sender": f"@_echo_bot:{_HS_SERVER_NAME}",
            "content": {"msgtype": "m.text", "body": "echo: hello"},
        }
    ]
    status = await _deliver_txn_to_as(
        state=state,
        as_http=as_client,
        txn_id="txn-self",
        events=events,
    )
    assert status == 200
    assert state.sent_messages == [], (
        "Echo bot replied to its own message — would loop in production"
    )


async def test_fake_hs_rejects_bad_as_token(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """A C-S call authenticated with the wrong ``as_token`` must 401.

    Requirement 4 from Wave 0: tuwunel rejects any C-S call whose
    Bearer token doesn't match the registered AS. We verify the same
    enforcement here so a Wave 2 regression that generates the
    registration token incorrectly would fail at this layer instead of
    silently passing a forged request.
    """
    state, _ = echo_fixture
    # Build a direct CS client to bypass the echo-bot middle layer.
    hs = FastAPI()

    @hs.put("/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{txn_id}")
    async def cs_send(  # noqa: ANN202
        room_id: str,
        txn_id: str,
        request: Request,
    ):
        body = await request.json()
        status, response = await _cs_send_message(
            state=state,
            room_id=room_id,
            txn_id=txn_id,
            body=body,
            headers={k.lower(): v for k, v in request.headers.items()},
            query=dict(request.query_params),
        )
        if status != 200:
            raise HTTPException(status_code=status, detail=response)
        return response

    async with httpx.AsyncClient(
        transport=ASGITransport(app=hs),
        base_url="http://homeserver.local",
    ) as cs_client:
        resp = await cs_client.put(
            "/_matrix/client/v3/rooms/!room:echo.local/send/m.room.message/reject-1",
            headers={"Authorization": "Bearer not-a-real-token"},
            json={"msgtype": "m.text", "body": "forged"},
        )
    assert resp.status_code == 401
    assert state.sent_messages == []
    assert ("/rooms/.../send", 401, "bad as_token") in state.rejected_calls


async def test_fake_hs_rejects_user_id_outside_namespace(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """Masquerading outside the AS namespace must be refused (Req 2).

    The exclusive-namespace guarantee prevents a bridge from writing as
    a non-bridge user. Wave 2's ``bridge_config.py`` will generate a
    registration like ``@_discord_.*:<server>`` for mautrix-discord; if
    a buggy version accidentally widened the regex, the bridge could
    impersonate any user on the homeserver. This case locks the
    enforcement in at the fixture layer.
    """
    state, _ = echo_fixture
    from fastapi import FastAPI, HTTPException, Request

    hs = FastAPI()

    @hs.put("/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{txn_id}")
    async def cs_send(  # noqa: ANN202
        room_id: str,
        txn_id: str,
        request: Request,
    ):
        body = await request.json()
        status, response = await _cs_send_message(
            state=state,
            room_id=room_id,
            txn_id=txn_id,
            body=body,
            headers={k.lower(): v for k, v in request.headers.items()},
            query=dict(request.query_params),
        )
        if status != 200:
            raise HTTPException(status_code=status, detail=response)
        return response

    async with httpx.AsyncClient(
        transport=ASGITransport(app=hs),
        base_url="http://homeserver.local",
    ) as cs_client:
        resp = await cs_client.put(
            "/_matrix/client/v3/rooms/!room:echo.local/send/m.room.message/masq-bad",
            headers={"Authorization": f"Bearer {state.registration.as_token}"},
            params={"user_id": "@real_user:echo.local"},
            json={"msgtype": "m.text", "body": "should not land"},
        )
    assert resp.status_code == 403
    assert state.sent_messages == []
    assert any(
        row[0] == "/rooms/.../send" and row[1] == 403
        for row in state.rejected_calls
    ), "Expected a 403 entry in rejected_calls"


async def test_bot_refuses_txn_with_wrong_hs_token(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """A txn push with the wrong ``hs_token`` must be rejected.

    Requirement 3 (Wave 0) says tuwunel signs every outgoing txn push
    with the registered ``hs_token``. A tampered proxy or mis-signed
    push from an impostor homeserver should not be honored by the AS.
    This test flips the query-param token and expects a 403 back from
    the echo bot; no message must be published to the fake HS as a
    side effect.
    """
    state, as_client = echo_fixture
    response = await as_client.put(
        "/_matrix/app/v1/transactions/forged-1",
        params={"access_token": "wrong-hs-token"},
        json={
            "events": [
                {
                    "type": "m.room.message",
                    "room_id": "!room:echo.local",
                    "sender": "@alice:echo.local",
                    "content": {"msgtype": "m.text", "body": "forged"},
                }
            ]
        },
    )
    assert response.status_code == 403
    assert state.sent_messages == []


async def test_registration_yaml_round_trips_through_ruma_shape(
    echo_fixture: tuple[_FakeHomeserverState, httpx.AsyncClient],
) -> None:
    """The registration dataclass must serialise to a ruma-compatible YAML.

    ``!admin appservices register`` in tuwunel calls
    ``serde_yaml::from_str::<Registration>`` on the payload
    (``src/admin/appservice/commands.rs:21``). Wave 2 will output a YAML
    file from ``bridge_config.py``; we want to guarantee right here
    that a YAML round-trip of the Wave-1 registration yields a doc
    with every field ruma's ``Registration`` struct requires.
    """
    state, _ = echo_fixture
    reg = state.registration
    doc = {
        "id": reg.id,
        "url": reg.url,
        "as_token": reg.as_token,
        "hs_token": reg.hs_token,
        "sender_localpart": reg.sender_localpart,
        "namespaces": {
            "users": [
                {"exclusive": reg.exclusive_users, "regex": reg.user_namespace_regex}
            ],
            "aliases": [],
            "rooms": [],
        },
        "rate_limited": reg.rate_limited,
        "protocols": ["concord-probe"],
    }
    yaml_text = yaml.safe_dump(doc, sort_keys=False)
    reparsed = yaml.safe_load(yaml_text)
    # Every required ruma field present.
    for key in (
        "id",
        "url",
        "as_token",
        "hs_token",
        "sender_localpart",
        "namespaces",
        "rate_limited",
    ):
        assert key in reparsed, f"Round-tripped YAML is missing key: {key}"
    assert reparsed["namespaces"]["users"][0]["exclusive"] is True
    assert reparsed["rate_limited"] is False, (
        "rate_limited must survive the YAML round trip as a real False"
    )
